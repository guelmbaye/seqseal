import {
  SCHEMA_VERSION,
  sha256Hex,
  toIso,
  type NormalizedObservation,
  type ObservationFamily,
  type RawSourceRecord,
  type SourceHealth,
  type SourceProfile,
} from "@seqseal/contracts";
import { parseRingWebhook, type ParsedRingEvent } from "./envelope";

/** Physical observations may become workflow evidence; health events never do (Doc 04 §70). */
export const PHYSICAL_EVENT_TYPES = new Set(["motion_detected", "button_press", "live_view_simulation"]);
export const HEALTH_EVENT_TYPES = new Set([
  "device_online",
  "device_offline",
  "device_added",
  "device_removed",
  "app_integration_removed",
  "subscription_changed",
  "media_unreadable",
]);

export function classifyEventType(type: string): ObservationFamily {
  if (PHYSICAL_EVENT_TYPES.has(type)) return "WORKFLOW_PHYSICAL";
  if (HEALTH_EVENT_TYPES.has(type)) return "INTEGRATION_HEALTH";
  return "UNKNOWN";
}

/** Health status implied by an integration-health event. */
export function healthFromEvent(type: string): SourceHealth | undefined {
  switch (type) {
    case "device_online":
    case "device_added":
      return "HEALTHY";
    case "device_offline":
    case "device_removed":
      return "OFFLINE";
    case "app_integration_removed":
      return "ACCESS_REVOKED";
    case "media_unreadable":
      return "MEDIA_UNREADABLE";
    default:
      return undefined;
  }
}

/** Event-level identity: protects against reprocessing the same underlying Ring event (Doc 04 §25). */
export function eventIdempotencyKey(profile: SourceProfile, eventId: string, runId?: string): string {
  return `event:${profile}:${runId ? `${runId}:` : ""}${eventId}`;
}

/** Delivery-level identity: protects against repeated webhook deliveries. */
export function deliveryIdempotencyKey(profile: SourceProfile, requestId: string, runId?: string): string {
  return `delivery:${profile}:${runId ? `${runId}:` : ""}${requestId}`;
}

export function observationIdFor(eventKey: string): string {
  return `OBS-${sha256Hex(eventKey).slice(0, 10)}`;
}

/** When Ring omits a physical timestamp we fall back to the send time — flagged and imprecise. */
const SEND_TIME_PRECISION_MS = 30_000;

export interface NormalizeContext {
  record: RawSourceRecord;
}

export type NormalizeOutcome =
  | { ok: true; observation: NormalizedObservation; event: ParsedRingEvent; eventKey: string }
  | { ok: false; error: string };

/**
 * Ring payload → NormalizedObservation. Preserves identifiers verbatim (component ids
 * are opaque), keeps occurrence time separate from receive time, never invents a
 * workflow state and never evaluates PWPS.
 */
export function normalizeRingRecord(ctx: NormalizeContext): NormalizeOutcome {
  const { record } = ctx;
  const parsed = parseRingWebhook(record.payload);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const ev = parsed.event;
  const eventKey = eventIdempotencyKey(record.source_profile, ev.event_id, record.replay?.run_id);

  const rawAttrs = (ev.raw.data.attributes ?? {}) as Record<string, unknown>;
  let occurredMs = ev.occurred_at_ms;
  let precision = 0;
  let timestampSource = "data.attributes.timestamp";
  if (occurredMs === undefined && ev.sent_at) {
    occurredMs = Date.parse(ev.sent_at);
    precision = SEND_TIME_PRECISION_MS;
    timestampSource = "meta.time (send time fallback)";
  }
  if (occurredMs === undefined || Number.isNaN(occurredMs)) occurredMs = Date.parse(record.received_at);
  if (typeof rawAttrs.time_precision_ms === "number") precision = rawAttrs.time_precision_ms;

  const attributes: Record<string, unknown> = { timestamp_source: timestampSource };
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (!["source", "source_type", "timestamp", "component_ids"].includes(k)) attributes[k] = v;
  }

  const observation: NormalizedObservation = {
    schema_version: SCHEMA_VERSION,
    observation_id: observationIdFor(eventKey),
    correlation_id: record.correlation_id,
    family: classifyEventType(ev.event_type),
    source_provider: record.provider,
    source_profile: record.source_profile,
    ...(ev.account_id ? { source_account_ref: ev.account_id } : {}),
    ...(ev.device_id ? { source_device_ref: ev.device_id } : {}),
    source_component_refs: ev.component_ids,
    source_event_ref: ev.event_id,
    request_ref: ev.request_id,
    event_type: ev.event_type,
    ...(ev.sub_type ? { event_subtype: ev.sub_type } : {}),
    occurred_at: toIso(occurredMs),
    received_at: record.received_at,
    time_precision_ms: precision,
    source_health: healthFromEvent(ev.event_type) ?? "HEALTHY",
    raw_source_ref: record.source_record_id,
    attributes,
    ...(record.replay ? { replay: record.replay } : {}),
  };
  return { ok: true, observation, event: ev, eventKey };
}
