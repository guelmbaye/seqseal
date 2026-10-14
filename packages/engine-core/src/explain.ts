import { humanizeDuration, type CompiledProtocol, type CompiledRule, type RuleResult } from "@pwps/core";

/** Deterministic HH:MM:SS (UTC) — never locale-dependent. */
export function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

export function stateLabel(p: CompiledProtocol, id: string): string {
  return (p.stateIndex[id]?.label ?? id).toUpperCase();
}

const at = (r: RuleResult, s: string): number | null => {
  const v = r.observed[s];
  return typeof v === "number" ? v : null;
};

/**
 * Mechanical explanation of a rule result. Every sentence is derived from stored
 * rule data — no generative text (Doc 07 §99, explanation fidelity).
 */
export function explainRule(p: CompiledProtocol, rule: CompiledRule, r: RuleResult): { code: string; text: string } {
  const L = (s: string) => stateLabel(p, s);
  const reasonText = (states: string[]): { code: string; text: string } => {
    switch (r.reason) {
      case "MISSING_EVIDENCE": {
        const missing = states.filter((s) => r.observed[s] === null).map(L);
        return { code: "AWAITING_EVIDENCE", text: `Not evaluable yet: ${missing.join(" and ")} not observed.` };
      }
      case "UNRESOLVED_EVIDENCE": {
        const unresolved = states.filter((s) => r.observed[s] === "UNRESOLVED").map(L);
        return { code: "EVIDENCE_UNRESOLVED", text: `Could not be evaluated because ${unresolved.join(" and ")} evidence is unresolved.` };
      }
      case "COVERAGE_GAP": {
        const gap = states.filter((s) => r.observed[s] === "UNRESOLVED").map(L);
        return { code: "COVERAGE_GAP", text: `Could not be evaluated: observation coverage gap for ${gap.join(" and ")}.` };
      }
      case "AMBIGUOUS_ORDER":
        return { code: "AMBIGUOUS_ORDER", text: `${states.map(L).join(" and ")} timestamps are indistinguishable; strict order cannot be established.` };
      case "AMBIGUOUS_TIMING":
        return { code: "AMBIGUOUS_TIMING", text: `Timestamp precision cannot establish whether the duration limit holds.` };
      case "AMBIGUOUS_TIMESTAMP":
        return { code: "AMBIGUOUS_TIMESTAMP", text: `Evidence timestamps are not usable for ordering.` };
      case "NOT_OBSERVED":
        return { code: "NOT_APPLICABLE", text: `The constrained transition did not occur.` };
      default:
        return { code: "NOT_EVALUABLE", text: "Not evaluable." };
    }
  };

  switch (rule.kind) {
    case "REQUIRED": {
      const t = at(r, rule.state);
      if (r.status === "PASS" && t !== null) return { code: "REQUIRED_PRESENT", text: `${L(rule.state)} observed at ${clock(t)}.` };
      if (r.reason === "MISSING_EVIDENCE") return { code: "REQUIRED_MISSING", text: `Required ${L(rule.state)} evidence has not been observed.` };
      return reasonText([rule.state]);
    }
    case "PRECEDENCE": {
      const a = at(r, rule.first);
      const b = at(r, rule.second);
      if (r.status === "PASS" && a !== null && b !== null) {
        return { code: "ORDER_SATISFIED", text: `${L(rule.first)} (${clock(a)}) preceded ${L(rule.second)} (${clock(b)}).` };
      }
      if (r.status === "FAIL" && a !== null && b !== null) {
        return {
          code: "ORDER_VIOLATED",
          text: `${L(rule.second)} occurred ${humanizeDuration(a - b)} before required ${L(rule.first)}.`,
        };
      }
      return reasonText([rule.first, rule.second]);
    }
    case "WITHIN": {
      const a = at(r, rule.anchor);
      const t = at(r, rule.target);
      if (a !== null && t !== null && r.status !== "NOT_EVALUABLE") {
        if (t < a) return { code: "TIMING_VIOLATED", text: `${L(rule.target)} occurred before ${L(rule.anchor)}.` };
        const verb = r.status === "PASS" ? "TIMING_SATISFIED" : "TIMING_VIOLATED";
        return {
          code: verb,
          text: `${L(rule.target)} occurred ${humanizeDuration(t - a)} after ${L(rule.anchor)} (limit ${humanizeDuration(rule.maxMs)}).`,
        };
      }
      return reasonText([rule.anchor, rule.target]);
    }
    case "FORBIDDEN_TRANSITION":
      if (r.status === "FAIL") return { code: "FORBIDDEN_TRANSITION_OBSERVED", text: `Forbidden transition ${L(rule.from)} → ${L(rule.to)} was observed.` };
      if (r.status === "PASS") return { code: "FORBIDDEN_TRANSITION_ABSENT", text: `Forbidden transition ${L(rule.from)} → ${L(rule.to)} did not occur.` };
      return reasonText([rule.from, rule.to]);
    case "FORBIDDEN_STATE":
      if (r.status === "FAIL") return { code: "FORBIDDEN_STATE_OBSERVED", text: `Forbidden state ${L(rule.state)} was observed.` };
      if (r.status === "PASS") return { code: "FORBIDDEN_STATE_ABSENT", text: `Forbidden state ${L(rule.state)} was not observed.` };
      return reasonText([rule.state]);
  }
}
