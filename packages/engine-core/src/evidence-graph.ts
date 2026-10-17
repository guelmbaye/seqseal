import type { CompiledProtocol, RuleResult, Timeline } from "@pwps/core";
import { toIso, type EvidenceGraph } from "@seqseal/contracts";

/**
 * Evidence Graph (Master Brief §7): the observed model the Sequence Integrity Engine reasons over.
 *
 *   nodes           one per protocol state: PRESENT (with time, precision and evidence),
 *                   UNRESOLVED or ABSENT
 *   edges           temporal relations between every pair of PRESENT states, using the same
 *                   precision semantics as the PWPS reference rules: two states are ordered only
 *                   when their time difference exceeds the larger precision
 *   protocol_edges  each PWPS ordering/timing rule laid over the observation, with its result
 *
 * Pure and deterministic: derived from the timeline the rules are evaluated on, so a protocol
 * edge's `observed` relation always agrees with that rule's status.
 */
export function buildEvidenceGraph(protocol: CompiledProtocol, timeline: Timeline, results: RuleResult[]): EvidenceGraph {
  const nodes = protocol.states.map((s) => {
    const t = timeline[s.id];
    if (t?.status === "PRESENT") {
      return { state: s.id, status: "PRESENT" as const, occurred_at: toIso(t.at), precision_ms: t.precisionMs ?? 0, evidence_refs: t.refs ?? [] };
    }
    if (t?.status === "UNRESOLVED") {
      return { state: s.id, status: "UNRESOLVED" as const, evidence_refs: t.refs ?? [], ...(t.reason ? { reason: t.reason } : {}) };
    }
    return { state: s.id, status: "ABSENT" as const, evidence_refs: [] };
  });

  const present = protocol.states
    .flatMap((s) => {
      const t = timeline[s.id];
      return t?.status === "PRESENT" ? [{ state: s.id, at: t.at, precision: t.precisionMs ?? 0, index: s.index }] : [];
    })
    .sort((a, b) => a.at - b.at || a.index - b.index);

  const edges: EvidenceGraph["edges"] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const a = present[i]!;
      const b = present[j]!;
      const delta = b.at - a.at;
      const undetermined = Math.abs(delta) <= Math.max(a.precision, b.precision);
      edges.push({ from: a.state, to: b.state, relation: undetermined ? "ORDER_UNDETERMINED" : "OBSERVED_BEFORE", delta_ms: delta });
    }
  }

  const relation = (from: string, to: string): EvidenceGraph["protocol_edges"][number]["observed"] => {
    const a = timeline[from];
    const b = timeline[to];
    if (a?.status !== "PRESENT" || b?.status !== "PRESENT") return "NOT_OBSERVED";
    const delta = b.at - a.at;
    if (Math.abs(delta) <= Math.max(a.precisionMs ?? 0, b.precisionMs ?? 0)) return "ORDER_UNDETERMINED";
    return delta > 0 ? "OBSERVED_BEFORE" : "OBSERVED_AFTER";
  };
  const statusOf = new Map(results.map((r) => [r.rule_id, r.status]));
  const protocol_edges: EvidenceGraph["protocol_edges"] = protocol.rules.flatMap((r): EvidenceGraph["protocol_edges"] => {
    if (r.kind === "PRECEDENCE") {
      return [{ rule_id: r.id, from: r.first, to: r.second, relation: "MUST_PRECEDE" as const, status: statusOf.get(r.id) ?? "NOT_EVALUABLE", observed: relation(r.first, r.second) }];
    }
    if (r.kind === "WITHIN") {
      return [{ rule_id: r.id, from: r.anchor, to: r.target, relation: "WITHIN" as const, status: statusOf.get(r.id) ?? "NOT_EVALUABLE", observed: relation(r.anchor, r.target) }];
    }
    return [];
  });

  return { nodes, edges, protocol_edges };
}
