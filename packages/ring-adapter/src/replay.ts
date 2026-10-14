import { z } from "zod";
import { SourceProfile, Verdict, Action } from "@seqseal/contracts";
import { buildRingWebhookEnvelope, type RingWebhookEnvelope } from "./envelope";

/**
 * Fixture replay (Doc 05 §106, Doc 06 §104). Scenarios are written as source-level
 * Ring events and replayed as documented-shape Ring webhook envelopes through the SAME
 * normalization → evidence → engine → policy → gate pipeline. Replay never sets a
 * verdict or an action. Every replayed observation is labelled FIXTURE_REPLAY.
 */
export const ReplayEvent = z.object({
  id: z.string().optional(),
  at: z.string(),
  type: z.string(),
  subtype: z.string().optional(),
  device: z.string(),
  components: z.array(z.string()).optional(),
  precision_ms: z.number().int().nonnegative().optional(),
  omit_timestamp: z.boolean().optional(),
  mock_interpretation: z.record(z.unknown()).optional(),
  note: z.string().optional(),
});
export type ReplayEvent = z.infer<typeof ReplayEvent>;

export const ReplayScenario = z.object({
  scenario_id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  base_time: z.string().datetime({ offset: true }),
  source_profile: SourceProfile.default("FIXTURE_REPLAY"),
  events: z.array(ReplayEvent).min(1),
  /** Network delivery order (indices into events). Defaults to event order. */
  delivery_order: z.array(z.number().int().nonnegative()).optional(),
  /** Same webhook delivered again (same request_id) — delivery idempotency. */
  duplicate_deliveries: z.array(z.number().int().nonnegative()).default([]),
  /** Same Ring event re-sent with a new request_id — event idempotency. */
  duplicate_events: z.array(z.number().int().nonnegative()).default([]),
  /** Indices delivered only after explicit finalization (late evidence → amendment). */
  late_after_finalize: z.array(z.number().int().nonnegative()).default([]),
  /** Explicitly finalize after delivery (e.g. execution deadline reached). */
  finalize_at_end: z.boolean().default(false),
  expected: z
    .object({
      verdict: Verdict.optional(),
      action: Action.optional(),
      primary_rule: z.string().optional(),
      /** false = invalid or unsupported execution: must never RELEASE. */
      supported: z.boolean(),
      /** True when no execution may be created (e.g. rejected signatures). */
      no_execution: z.boolean().optional(),
      /** Expected infrastructure failure code (never a semantic verdict). */
      system_error: z.string().optional(),
      receipt_versions: z.number().int().optional(),
      /** Exact number of business events per name for the execution, e.g. { "WorkflowHeld": 1 }. */
      action_events: z.record(z.number().int()).optional(),
      notes: z.string().optional(),
    })
    .optional(),
  /** Post-run checks implemented by the benchmark runner (e.g. redeliver_decisions, review_confirm). */
  checks: z.array(z.string()).default([]),
  inject_faults: z.object({ engine: z.boolean().optional(), gate: z.boolean().optional() }).optional(),
  signature: z.enum(["valid", "invalid"]).optional(),
});
export type ReplayScenario = z.infer<typeof ReplayScenario>;

export interface ReplayDelivery {
  seq: number;
  phase: "main" | "after_finalize";
  kind: "original" | "duplicate_delivery" | "duplicate_event";
  event_index: number;
  request_id: string;
  occurred_at_ms: number;
  body: RingWebhookEnvelope;
  rawBody: string;
}

export function parseOffset(base: number, at: string): number {
  if (!at.startsWith("+")) {
    const abs = Date.parse(at);
    if (Number.isNaN(abs)) throw new Error(`Invalid replay time "${at}"`);
    return abs;
  }
  let total = 0;
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let m: RegExpExecArray | null;
  let consumed = 1;
  while ((m = re.exec(at))) {
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3_600_000 : m[2] === "m" ? n * 60_000 : m[2] === "s" ? n * 1000 : n;
    consumed += m[0].length;
  }
  if (consumed !== at.length) throw new Error(`Invalid replay offset "${at}" (use e.g. +3m, +90s, +2m30s)`);
  return base + total;
}

export function buildReplayDeliveries(scenario: ReplayScenario, opts: { runId: string; accountId?: string }): ReplayDelivery[] {
  const base = Date.parse(scenario.base_time);
  const order = scenario.delivery_order ?? scenario.events.map((_, i) => i);
  const late = new Set(scenario.late_after_finalize);
  const deliveries: ReplayDelivery[] = [];
  let seq = 0;

  const make = (i: number, kind: ReplayDelivery["kind"], phase: ReplayDelivery["phase"]) => {
    const e = scenario.events[i];
    if (!e) throw new Error(`Scenario ${scenario.scenario_id}: no event at index ${i}`);
    const occurred = parseOffset(base, e.at);
    const requestId = kind === "duplicate_event" ? `${opts.runId}-req-${i}-resent` : `${opts.runId}-req-${i}`;
    const extra: Record<string, unknown> = {};
    if (e.mock_interpretation) extra.mock_interpretation = e.mock_interpretation;
    if (e.precision_ms !== undefined) extra.time_precision_ms = e.precision_ms;
    if (e.note) extra.fixture_note = e.note;
    const env = buildRingWebhookEnvelope({
      request_id: requestId,
      ...(opts.accountId ? { account_id: opts.accountId } : {}),
      device_id: e.device,
      event_type: e.type,
      ...(e.subtype ? { sub_type: e.subtype } : {}),
      occurred_at_ms: occurred,
      ...(e.components ? { component_ids: e.components } : {}),
      extra_attributes: extra,
    });
    if (e.id) env.data.id = e.id;
    if (e.omit_timestamp && env.data.attributes) delete (env.data.attributes as Record<string, unknown>).timestamp;
    deliveries.push({ seq: seq++, phase, kind, event_index: i, request_id: requestId, occurred_at_ms: occurred, body: env, rawBody: JSON.stringify(env) });
  };

  for (const i of order) {
    if (late.has(i)) continue;
    make(i, "original", "main");
    if (scenario.duplicate_deliveries.includes(i)) {
      const prev = deliveries[deliveries.length - 1]!;
      deliveries.push({ ...prev, seq: seq++, kind: "duplicate_delivery" });
    }
    if (scenario.duplicate_events.includes(i)) make(i, "duplicate_event", "main");
  }
  for (const i of scenario.late_after_finalize) make(i, "original", "after_finalize");
  return deliveries;
}
