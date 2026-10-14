import { z } from "zod";

/**
 * Ring webhook envelope (JSON:API style), per the Ring developer documentation:
 *
 *   meta: { version, time (ISO send time), request_id, account_id }
 *   data: { id: "<device_id>_<type>_<timestamp>", type, subType?,
 *           attributes: { source (device id), source_type: "devices", timestamp (epoch ms), component_ids? },
 *           relationships: { devices: { links: { self } } } }
 *
 * Unknown fields are preserved (passthrough) and never interpreted by the protocol engine.
 * `subType` is treated as an open vocabulary (Doc 04 §30). Field paths are tolerant of
 * snake_case variants so a documentation/version drift is surfaced, not silently dropped.
 * Sources: https://developer.amazon.com/docs/ring/notifications.html,
 *          https://developer.amazon.com/docs/ring/motion-detection.html
 */
export const RingWebhookEnvelope = z
  .object({
    meta: z
      .object({
        version: z.string().optional(),
        time: z.string().optional(),
        request_id: z.string().min(1),
        account_id: z.string().optional(),
      })
      .passthrough(),
    data: z
      .object({
        id: z.string().min(1),
        type: z.string().min(1),
        subType: z.string().optional(),
        sub_type: z.string().optional(),
        attributes: z
          .object({
            source: z.string().optional(),
            source_type: z.string().optional(),
            timestamp: z.union([z.number(), z.string()]).optional(),
            component_ids: z.array(z.union([z.string(), z.number()])).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type RingWebhookEnvelope = z.infer<typeof RingWebhookEnvelope>;

export interface ParsedRingEvent {
  request_id: string;
  account_id?: string;
  envelope_version?: string;
  sent_at?: string;
  event_id: string;
  event_type: string;
  sub_type?: string;
  device_id?: string;
  /** Physical occurrence time (epoch ms) when Ring supplies it. */
  occurred_at_ms?: number;
  component_ids: string[];
  raw: RingWebhookEnvelope;
}

export type ParseOutcome = { ok: true; event: ParsedRingEvent } | { ok: false; error: string };

function toEpochMs(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v < 1e12 ? Math.round(v * 1000) : v; // tolerate seconds
  const n = Number(v);
  if (!Number.isNaN(n)) return n < 1e12 ? Math.round(n * 1000) : n;
  const d = Date.parse(v);
  return Number.isNaN(d) ? undefined : d;
}

export function parseRingWebhook(body: unknown): ParseOutcome {
  const r = RingWebhookEnvelope.safeParse(body);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const env = r.data;
  const attrs = env.data.attributes ?? {};
  const deviceFromId = env.data.id.includes("_") ? env.data.id.split("_")[0] : undefined;
  return {
    ok: true,
    event: {
      request_id: env.meta.request_id,
      ...(env.meta.account_id ? { account_id: env.meta.account_id } : {}),
      ...(env.meta.version ? { envelope_version: env.meta.version } : {}),
      ...(env.meta.time ? { sent_at: env.meta.time } : {}),
      event_id: env.data.id,
      event_type: env.data.type,
      ...((env.data.subType ?? env.data.sub_type) ? { sub_type: env.data.subType ?? env.data.sub_type } : {}),
      ...((attrs.source ?? deviceFromId) ? { device_id: attrs.source ?? deviceFromId } : {}),
      ...(toEpochMs(attrs.timestamp) !== undefined ? { occurred_at_ms: toEpochMs(attrs.timestamp) } : {}),
      component_ids: (attrs.component_ids ?? []).map(String),
      raw: env,
    },
  };
}

/** Build a documented-shape Ring webhook envelope (used by fixture replay and signed test webhooks). */
export function buildRingWebhookEnvelope(args: {
  request_id: string;
  account_id?: string;
  device_id: string;
  event_type: string;
  sub_type?: string;
  occurred_at_ms: number;
  sent_at?: string;
  component_ids?: string[];
  extra_attributes?: Record<string, unknown>;
}): RingWebhookEnvelope {
  return {
    meta: {
      version: "1.1",
      time: args.sent_at ?? new Date(args.occurred_at_ms).toISOString(),
      request_id: args.request_id,
      ...(args.account_id ? { account_id: args.account_id } : {}),
    },
    data: {
      id: `${args.device_id}_${args.sub_type ?? args.event_type}_${args.occurred_at_ms}`,
      type: args.event_type,
      ...(args.sub_type ? { subType: args.sub_type } : {}),
      attributes: {
        source: args.device_id,
        source_type: "devices",
        timestamp: args.occurred_at_ms,
        ...(args.component_ids?.length ? { component_ids: args.component_ids } : {}),
        ...(args.extra_attributes ?? {}),
      },
      relationships: { devices: { links: { self: `/v1/devices/${args.device_id}` } } },
    },
  };
}
