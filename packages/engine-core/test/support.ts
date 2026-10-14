import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePwpsFile } from "@pwps/core";
import type { Evidence, EvidenceCandidate, InterpretationMode } from "@seqseal/contracts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const idp01 = () => compilePwpsFile(join(repoRoot, "protocols", "inbound-delivery.yaml"));

const BASE = Date.parse("2026-10-18T14:00:00Z");
export const at = (minutes: number, seconds = 0) => new Date(BASE + minutes * 60_000 + seconds * 1000).toISOString();

let n = 0;
export function ev(state: string, minutes: number, opts: { mode?: InterpretationMode; precision?: number; seconds?: number; id?: string } = {}): Evidence {
  const id = opts.id ?? `EV-${state.toUpperCase()}-${++n}`;
  return {
    evidence_id: id,
    candidate_id: id.replace(/^EV-/, "CAN-"),
    execution_id: "EXEC-TEST",
    semantic_state: state,
    occurred_at: at(minutes, opts.seconds ?? 0),
    time_precision_ms: opts.precision ?? 0,
    logical_zone: "zone",
    interpretation_mode: opts.mode ?? "CONFIGURED_MAPPING",
    observation_refs: [`OBS-${id}`],
    source_refs: [{ provider: "ring", source_profile: "RING_WEBHOOK", source_event_ref: `ring-${id}`, device_ref: "dev" }],
    resolver_version: "test",
    acceptance_rule: "test",
    accepted_at: at(0),
  };
}

export function cand(state: string, minutes: number, status: EvidenceCandidate["status"] = "UNCERTAIN"): EvidenceCandidate {
  const id = `CAN-${state.toUpperCase()}-U${++n}`;
  return {
    candidate_id: id,
    execution_id: "EXEC-TEST",
    semantic_state: state,
    occurred_at: at(minutes),
    time_precision_ms: 0,
    logical_zone: "zone",
    interpretation_mode: "AI_ASSISTED",
    status,
    assessment: "AMBIGUOUS",
    quality: "LOW",
    observation_refs: [`OBS-${id}`],
    source_refs: [{ provider: "ring", source_profile: "RING_WEBHOOK", source_event_ref: `ring-${id}` }],
    resolver_version: "test",
    created_at: at(0),
  };
}

/** A: ARRIVAL 14:00, STAGING 14:03, STORAGE 14:06, DEPARTURE 14:09, CLEAR 14:11 */
export const sequenceA = () => [ev("arrival", 0), ev("staging", 3), ev("storage", 6), ev("departure", 9), ev("clear", 11)];
/** B: ARRIVAL 14:00, STORAGE 14:03, STAGING 14:06, DEPARTURE 14:09, CLEAR 14:11 */
export const sequenceB = () => [ev("arrival", 0), ev("storage", 3), ev("staging", 6), ev("departure", 9), ev("clear", 11)];
