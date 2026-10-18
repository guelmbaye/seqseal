import { z } from "zod";
import { SCHEMA_VERSION, type NormalizedObservation, type RawSourceRecord } from "@seqseal/contracts";
import { eventIdempotencyKey, observationIdFor, type NormalizeOutcome } from "./normalize";

/**
 * Ring Developer Playground capture.
 *
 * The Playground exposes simulated live-view sources (Package, Vehicle, Motion) behind
 * real Ring API calls. It is NOT a production webhook simulator, so SEQSEAL never
 * fabricates `motion_detected.package_delivery` from it (Doc 04 §9, §40). A capture
 * records what the Ring API actually returned plus the zone the operator declared for
 * that session; the observation type is `live_view_simulation`.
 */
export const SIMULATION_SOURCES = ["PACKAGE", "VEHICLE", "MOTION"] as const;

export const PlaygroundCapture = z.object({
  capture_id: z.string().min(1),
  simulation_source: z.enum(SIMULATION_SOURCES),
  session_zone: z.string().min(1),
  device_id: z.string().optional(),
  component_id: z.string().optional(),
  media_session_ref: z.string().optional(),
  captured_at: z.string().datetime({ offset: true }),
  /** Proof that the Ring API participated: the call made and its outcome. */
  api_evidence: z.object({
    method: z.string(),
    endpoint: z.string(),
    http_status: z.number().int(),
    request_id: z.string().optional(),
    response_excerpt: z.unknown().optional(),
  }),
  operator_note: z.string().optional(),
  /**
   * The Ring history event the simulation produced, when the capture could find it
   * (GET /v1/history/devices/{id}/events right after the simulation). When present it is the
   * source event reference and its timestamp is the physical occurrence time.
   */
  ring_event: z
    .object({
      event_id: z.string().min(1),
      event_type: z.string().optional(),
      /** Physical time of the event: `attributes.start` of the Ring history event. */
      occurred_at: z.string().datetime({ offset: true }).optional(),
      /** End of the event (`attributes.end`); a Playground simulation lasts about 22 s. */
      ended_at: z.string().datetime({ offset: true }).optional(),
    })
    .optional(),
});
export type PlaygroundCapture = z.infer<typeof PlaygroundCapture>;

/** Profiles a Playground capture may be ingested under: live, or replayed later from a saved session. */
export const CAPTURE_PROFILES = ["RING_PLAYGROUND", "RING_DERIVED_REPLAY"] as const;
export type CaptureProfile = (typeof CAPTURE_PROFILES)[number];

export function isPlaygroundCapture(payload: unknown): boolean {
  return PlaygroundCapture.safeParse(payload).success;
}

/**
 * Pick the newest event from a Ring event-history response. Tolerant on purpose: the exact
 * shape must be confirmed during the Ring Source Spike (docs/ring-playground-observations.md),
 * so it accepts a JSON:API `data` array, `events`/`items` arrays or a bare array, and reads
 * `id`/`event_id`, `type`/`event_type` and an epoch-ms or ISO timestamp from the item or its
 * `attributes`. Returns undefined when nothing identifiable is found — it never invents an event.
 */
export interface RingHistoryEvent {
  event_id: string;
  event_type?: string;
  /** Start of the event, ISO 8601. */
  occurred_at?: string;
  /** End of the event, ISO 8601, when Ring gives one. */
  ended_at?: string;
  raw: unknown;
}

/**
 * Newest event of a `GET /v1/history/devices/{id}/events` response.
 *
 * Observed shape (Ring Developer Playground, 2026-10-18): JSON:API `data[]` of
 * `{ type: "history-events", id, attributes: { event_type: "on_demand", start, end,
 * is_third_party_reviewed }, relationships: { cv_detections, source } }`, with `start` and
 * `end` in epoch milliseconds. Other field names are still accepted, and an item without an
 * id is never turned into an event.
 */
export function latestHistoryEvent(body: unknown): RingHistoryEvent | undefined {
  const obj = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body) ? body : [obj.data, obj.events, obj.items, obj.results].find(Array.isArray);
  if (!Array.isArray(list)) return undefined;
  const toIsoTime = (v: unknown): string | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
    if (typeof v === "string") {
      if (/^\d{10,13}$/.test(v)) return toIsoTime(Number(v));
      const t = Date.parse(v);
      return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    return undefined;
  };
  let best: RingHistoryEvent | undefined;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const at = (it.attributes ?? {}) as Record<string, unknown>;
    const id = it.id ?? it.event_id ?? at.id ?? at.event_id;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const type = it.event_type ?? at.event_type ?? at.type ?? it.type;
    const when = toIsoTime(at.start ?? it.start ?? at.timestamp ?? it.timestamp ?? at.created_at ?? it.created_at ?? at.start_time ?? it.start_time ?? at.time ?? it.time);
    const until = toIsoTime(at.end ?? it.end ?? at.end_time ?? it.end_time);
    const cand: RingHistoryEvent = {
      event_id: String(id),
      ...(typeof type === "string" ? { event_type: type } : {}),
      ...(when ? { occurred_at: when } : {}),
      ...(when && until ? { ended_at: until } : {}),
      raw: item,
    };
    if (!best || (cand.occurred_at ?? "") > (best.occurred_at ?? "")) best = cand;
  }
  return best;
}

export function normalizePlaygroundRecord(record: RawSourceRecord): NormalizeOutcome {
  const r = PlaygroundCapture.safeParse(record.payload);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const cap = r.data;
  if (cap.api_evidence.http_status < 200 || cap.api_evidence.http_status >= 300) {
    return { ok: false, error: `Playground capture ${cap.capture_id} has no successful Ring API call (HTTP ${cap.api_evidence.http_status}); refusing to create provenance.` };
  }
  const profile: CaptureProfile = record.source_profile === "RING_DERIVED_REPLAY" ? "RING_DERIVED_REPLAY" : "RING_PLAYGROUND";
  // A real Ring history event is the identity of the observation: capturing it twice is one event.
  const sourceEventRef = cap.ring_event?.event_id ?? cap.capture_id;
  const eventKey = eventIdempotencyKey(profile, sourceEventRef, record.replay?.run_id);
  const observation: NormalizedObservation = {
    schema_version: SCHEMA_VERSION,
    observation_id: observationIdFor(eventKey),
    correlation_id: record.correlation_id,
    family: "WORKFLOW_PHYSICAL",
    source_provider: "ring",
    source_profile: profile,
    ...(cap.device_id ? { source_device_ref: cap.device_id } : {}),
    source_component_refs: cap.component_id ? [cap.component_id] : [],
    source_event_ref: sourceEventRef,
    ...(cap.api_evidence.request_id ? { request_ref: cap.api_evidence.request_id } : {}),
    event_type: "live_view_simulation",
    simulation_source: cap.simulation_source,
    ...(cap.media_session_ref ? { media_session_ref: cap.media_session_ref } : {}),
    occurred_at: new Date(Date.parse(cap.ring_event?.occurred_at ?? cap.captured_at)).toISOString(),
    received_at: record.received_at,
    time_precision_ms: 1000,
    source_health: "HEALTHY",
    raw_source_ref: record.source_record_id,
    attributes: {
      session_zone: cap.session_zone,
      api_method: cap.api_evidence.method,
      api_endpoint: cap.api_evidence.endpoint,
      api_status: cap.api_evidence.http_status,
      zone_binding: "declared by operator at capture session",
      capture_id: cap.capture_id,
      time_source: cap.ring_event?.occurred_at ? "ring history event start" : "capture time",
      ...(cap.ring_event?.ended_at ? { ring_event_ended_at: cap.ring_event.ended_at } : {}),
      ...(cap.ring_event?.event_type ? { ring_event_type: cap.ring_event.event_type } : {}),
      ...(cap.operator_note ? { operator_note: cap.operator_note } : {}),
    },
    ...(record.replay ? { replay: record.replay } : {}),
  };
  return {
    ok: true,
    observation,
    eventKey,
    event: {
      request_id: cap.api_evidence.request_id ?? cap.capture_id,
      event_id: sourceEventRef,
      event_type: "live_view_simulation",
      component_ids: observation.source_component_refs,
      raw: { meta: { request_id: cap.capture_id }, data: { id: cap.capture_id, type: "live_view_simulation" } },
    },
  };
}
