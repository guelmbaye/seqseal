import { toMs, type CoverageStatus, type Evidence, type SourceBinding, type SourceHealthWindow, type SourceProfile } from "@seqseal/contracts";

export interface CoverageInput {
  zones: string[];
  bindings: SourceBinding[];
  /** Source profiles in use by the execution (bindings for other profiles are ignored). */
  profiles: SourceProfile[];
  windows: SourceHealthWindow[];
  from: string;
  to: string;
}

/**
 * Observation coverage per logical zone over an evidence-sensitive window (Doc 04 §66).
 *
 *   missing state + HEALTHY coverage  → INCOMPLETE (absence can be trusted)
 *   missing state + broken coverage   → UNCERTAIN  (absence cannot be trusted)
 *
 * Health windows are keyed by device ref. A zone with no binding for the execution's
 * profiles is UNKNOWN.
 */
export function computeCoverage(input: CoverageInput): Record<string, CoverageStatus> {
  const from = toMs(input.from);
  const to = toMs(input.to);
  const out: Record<string, CoverageStatus> = {};
  for (const zone of input.zones) {
    const bindings = input.bindings.filter((b) => b.active && b.logical_zone === zone && b.source_profiles.some((p) => input.profiles.includes(p)));
    if (!bindings.length) {
      out[zone] = "UNKNOWN";
      continue;
    }
    let unhealthy = 0;
    for (const b of bindings) {
      const key = b.source_device_ref;
      if (!key) continue;
      const bad = input.windows.some(
        (w) => w.source_key === key && w.status !== "HEALTHY" && toMs(w.from) <= to && (w.to === undefined || toMs(w.to) >= from),
      );
      if (bad) unhealthy++;
    }
    out[zone] = unhealthy === 0 ? "HEALTHY" : unhealthy === bindings.length ? "UNAVAILABLE" : "PARTIAL";
  }
  return out;
}

export interface EvidenceGraph {
  nodes: Array<{ id: string; state: string; occurred_at: string; mode: string }>;
  edges: Array<{ from: string; to: string; relation: "PRECEDES" | "SAME_STATE" }>;
}

/** Observed-world graph for display: temporal precedence between accepted evidence nodes. */
export function buildEvidenceGraph(evidence: Evidence[]): EvidenceGraph {
  const sorted = [...evidence].sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at) || a.evidence_id.localeCompare(b.evidence_id));
  const nodes = sorted.map((e) => ({ id: e.evidence_id, state: e.semantic_state, occurred_at: e.occurred_at, mode: e.interpretation_mode }));
  const edges: EvidenceGraph["edges"] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    edges.push({ from: prev.evidence_id, to: cur.evidence_id, relation: prev.semantic_state === cur.semantic_state ? "SAME_STATE" : "PRECEDES" });
  }
  return { nodes, edges };
}
