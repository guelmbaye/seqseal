import type { CompiledProtocol, CompiledRule } from "./compile";
import type { Severity } from "./types";

/**
 * PWPS reference rule semantics (SPEC §8, Conformance Level 4).
 *
 * This evaluator answers only "did each declared constraint PASS, FAIL or
 * remain NOT_EVALUABLE?". It never aggregates rules into a workflow verdict and
 * never decides a business action — those belong to consuming systems.
 */

export type StateObservation =
  | { status: "PRESENT"; at: number; precisionMs?: number; refs?: string[] }
  | { status: "ABSENT" }
  | { status: "UNRESOLVED"; reason: "UNRESOLVED_EVIDENCE" | "COVERAGE_GAP" | "AMBIGUOUS_TIMESTAMP"; refs?: string[] };

/** Map of state id → observation. States missing from the map are ABSENT. */
export type Timeline = Record<string, StateObservation>;

export type RuleStatus = "PASS" | "FAIL" | "NOT_EVALUABLE" | "NOT_APPLICABLE";

export type RuleReason =
  /** Required evidence is absent. Absence is never a FAIL (SPEC §8.1). */
  | "MISSING_EVIDENCE"
  /** Candidate evidence exists but is not authoritative. */
  | "UNRESOLVED_EVIDENCE"
  /** The observation source could not observe the relevant state. */
  | "COVERAGE_GAP"
  /** Timestamps cannot establish strict order. */
  | "AMBIGUOUS_ORDER"
  /** Timestamps cannot establish whether a duration bound holds. */
  | "AMBIGUOUS_TIMING"
  | "AMBIGUOUS_TIMESTAMP"
  /** The constrained transition/state did not occur. */
  | "NOT_OBSERVED";

export interface RuleResult {
  rule_id: string;
  operator: CompiledRule["operator"];
  kind: CompiledRule["kind"];
  severity: Severity;
  status: RuleStatus;
  reason?: RuleReason;
  /** States the rule constrains, in rule order. */
  states: string[];
  expected: Record<string, string | number>;
  /** Occurrence time (epoch ms) per involved state; null = absent, "UNRESOLVED" = not authoritative. */
  observed: Record<string, number | null | "UNRESOLVED">;
  /** For PRECEDENCE: t(second) − t(first). For WITHIN: t(target) − t(anchor). */
  delta_ms?: number;
  limit_ms?: number;
}

function obs(timeline: Timeline, state: string): StateObservation {
  return timeline[state] ?? { status: "ABSENT" };
}

function observedValue(o: StateObservation): number | null | "UNRESOLVED" {
  return o.status === "PRESENT" ? o.at : o.status === "UNRESOLVED" ? "UNRESOLVED" : null;
}

/** Reason when an operand is not PRESENT; unresolved outranks missing. */
function notPresentReason(...os: StateObservation[]): RuleReason {
  for (const o of os) {
    if (o.status === "UNRESOLVED") return o.reason === "AMBIGUOUS_TIMESTAMP" ? "AMBIGUOUS_TIMESTAMP" : o.reason;
  }
  return "MISSING_EVIDENCE";
}

/** Ordered sequence of PRESENT states (time, then declaration order). */
export function observedSequence(protocol: CompiledProtocol, timeline: Timeline): string[] {
  return Object.entries(timeline)
    .filter(([, o]) => o.status === "PRESENT")
    .map(([state, o]) => ({ state, at: (o as { at: number }).at, idx: protocol.stateIndex[state]?.index ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.at - b.at || a.idx - b.idx)
    .map((x) => x.state);
}

export function evaluateRule(protocol: CompiledProtocol, rule: CompiledRule, timeline: Timeline): RuleResult {
  const base = { rule_id: rule.id, operator: rule.operator, kind: rule.kind, severity: rule.severity };
  switch (rule.kind) {
    case "REQUIRED": {
      const o = obs(timeline, rule.state);
      const r = { ...base, states: [rule.state], expected: { state: rule.state }, observed: { [rule.state]: observedValue(o) } };
      if (o.status === "PRESENT") return { ...r, status: "PASS" };
      return { ...r, status: "NOT_EVALUABLE", reason: notPresentReason(o) };
    }
    case "PRECEDENCE": {
      const a = obs(timeline, rule.first);
      const b = obs(timeline, rule.second);
      const r = {
        ...base,
        states: [rule.first, rule.second],
        expected: { before: rule.first, after: rule.second },
        observed: { [rule.first]: observedValue(a), [rule.second]: observedValue(b) },
      };
      if (a.status !== "PRESENT" || b.status !== "PRESENT") {
        return { ...r, status: "NOT_EVALUABLE", reason: notPresentReason(a, b) };
      }
      const delta = b.at - a.at;
      const precision = Math.max(a.precisionMs ?? 0, b.precisionMs ?? 0);
      if (Math.abs(delta) <= precision) return { ...r, status: "NOT_EVALUABLE", reason: "AMBIGUOUS_ORDER", delta_ms: delta };
      return { ...r, status: delta > 0 ? "PASS" : "FAIL", delta_ms: delta };
    }
    case "WITHIN": {
      const a = obs(timeline, rule.anchor);
      const t = obs(timeline, rule.target);
      const r = {
        ...base,
        states: [rule.anchor, rule.target],
        expected: { anchor: rule.anchor, target: rule.target, max: rule.duration, max_ms: rule.maxMs },
        observed: { [rule.anchor]: observedValue(a), [rule.target]: observedValue(t) },
        limit_ms: rule.maxMs,
      };
      if (a.status !== "PRESENT" || t.status !== "PRESENT") {
        return { ...r, status: "NOT_EVALUABLE", reason: notPresentReason(a, t) };
      }
      const delta = t.at - a.at;
      const p = Math.max(a.precisionMs ?? 0, t.precisionMs ?? 0);
      if (Math.abs(delta) <= p) return { ...r, status: "NOT_EVALUABLE", reason: "AMBIGUOUS_ORDER", delta_ms: delta };
      if (delta < 0) return { ...r, status: "FAIL", delta_ms: delta };
      if (delta - p > rule.maxMs) return { ...r, status: "FAIL", delta_ms: delta };
      if (delta + p <= rule.maxMs) return { ...r, status: "PASS", delta_ms: delta };
      return { ...r, status: "NOT_EVALUABLE", reason: "AMBIGUOUS_TIMING", delta_ms: delta };
    }
    case "FORBIDDEN_STATE": {
      const o = obs(timeline, rule.state);
      const r = { ...base, states: [rule.state], expected: { forbidden_state: rule.state }, observed: { [rule.state]: observedValue(o) } };
      if (o.status === "PRESENT") return { ...r, status: "FAIL" };
      if (o.status === "UNRESOLVED") return { ...r, status: "NOT_EVALUABLE", reason: notPresentReason(o) };
      return { ...r, status: "PASS" };
    }
    case "FORBIDDEN_TRANSITION": {
      const from = obs(timeline, rule.from);
      const to = obs(timeline, rule.to);
      const r = {
        ...base,
        states: [rule.from, rule.to],
        expected: { forbidden_from: rule.from, forbidden_to: rule.to },
        observed: { [rule.from]: observedValue(from), [rule.to]: observedValue(to) },
      };
      if (from.status === "UNRESOLVED" || to.status === "UNRESOLVED") {
        return { ...r, status: "NOT_EVALUABLE", reason: notPresentReason(from, to) };
      }
      if (from.status !== "PRESENT" || to.status !== "PRESENT") return { ...r, status: "NOT_APPLICABLE", reason: "NOT_OBSERVED" };
      const seq = observedSequence(protocol, timeline);
      const i = seq.indexOf(rule.from);
      return { ...r, status: i >= 0 && seq[i + 1] === rule.to ? "FAIL" : "PASS" };
    }
  }
}

/** Evaluate every compiled rule in declaration order. Pure and deterministic. */
export function evaluateRules(protocol: CompiledProtocol, timeline: Timeline): RuleResult[] {
  return protocol.rules.map((rule) => evaluateRule(protocol, rule, timeline));
}
