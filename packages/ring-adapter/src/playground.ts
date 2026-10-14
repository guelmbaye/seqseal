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
});
export type PlaygroundCapture = z.infer<typeof PlaygroundCapture>;

export function normalizePlaygroundRecord(record: RawSourceRecord): NormalizeOutcome {
  const r = PlaygroundCapture.safeParse(record.payload);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const cap = r.data;
  if (cap.api_evidence.http_status < 200 || cap.api_evidence.http_status >= 300) {
    return { ok: false, error: `Playground capture ${cap.capture_id} has no successful Ring API call (HTTP ${cap.api_evidence.http_status}); refusing to create provenance.` };
  }
  const eventKey = eventIdempotencyKey("RING_PLAYGROUND", cap.capture_id, record.replay?.run_id);
  const observation: NormalizedObservation = {
    schema_version: SCHEMA_VERSION,
    observation_id: observationIdFor(eventKey),
    correlation_id: record.correlation_id,
    family: "WORKFLOW_PHYSICAL",
    source_provider: "ring",
    source_profile: "RING_PLAYGROUND",
    ...(cap.device_id ? { source_device_ref: cap.device_id } : {}),
    source_component_refs: cap.component_id ? [cap.component_id] : [],
    source_event_ref: cap.capture_id,
    ...(cap.api_evidence.request_id ? { request_ref: cap.api_evidence.request_id } : {}),
    event_type: "live_view_simulation",
    simulation_source: cap.simulation_source,
    ...(cap.media_session_ref ? { media_session_ref: cap.media_session_ref } : {}),
    occurred_at: new Date(Date.parse(cap.captured_at)).toISOString(),
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
      event_id: cap.capture_id,
      event_type: "live_view_simulation",
      component_ids: observation.source_component_refs,
      raw: { meta: { request_id: cap.capture_id }, data: { id: cap.capture_id, type: "live_view_simulation" } },
    },
  };
}
