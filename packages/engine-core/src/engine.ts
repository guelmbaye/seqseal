import { evaluateRules, type CompiledProtocol, type RuleResult, type Timeline } from "@pwps/core";
import {
  ENGINE_VERSION,
  MODE_TO_PWPS_AUTHORITY,
  hashCanonical,
  toIso,
  toMs,
  type CoverageStatus,
  type Counterfactual,
  type EngineResult,
  type EvaluationMode,
  type Evidence,
  type EvidenceCandidate,
  type IntegrityState,
  type ObservedStep,
  type RuleEvaluation,
  type UncertaintyItem,
  type Verdict,
} from "@seqseal/contracts";
import { explainRule, stateLabel } from "./explain";

/**
 * Sequence Integrity Engine — SEQSEAL Verification Profile over PWPS 0.1.
 *
 *   V = f(P, E)
 *
 * Pure function: no clock, no I/O, no model calls, no business actions.
 * It may not call Ring, call Bedrock, emit actions, modify evidence or mutate protocols (Doc 03 §26).
 */
export interface EngineInput {
  protocol: CompiledProtocol;
  /** Accepted, authoritative evidence attached to the execution. */
  evidence: Evidence[];
  /** Candidates that exist but are not authoritative (UNCERTAIN / MEDIA_PENDING). */
  unresolved?: EvidenceCandidate[];
  /**
   * Observation coverage per logical zone. When omitted entirely, every zone is assumed HEALTHY
   * (unit-test convenience). When provided, a missing zone is treated as UNKNOWN (conservative).
   */
  coverage?: Record<string, CoverageStatus>;
  /** Execution-level ambiguities supplied by correlation (e.g. CORRELATION_AMBIGUITY). */
  ambiguities?: UncertaintyItem[];
  mode: EvaluationMode;
  engineVersion?: string;
}

const UNCERTAIN_REASONS = new Set(["UNRESOLVED_EVIDENCE", "COVERAGE_GAP", "AMBIGUOUS_ORDER", "AMBIGUOUS_TIMING", "AMBIGUOUS_TIMESTAMP"]);
const FAILURE_PRIORITY: Record<string, number> = { PRECEDENCE: 0, FORBIDDEN_TRANSITION: 1, FORBIDDEN_STATE: 2, WITHIN: 3, REQUIRED: 4 };

interface StateFacts {
  /** Accepted evidence for the state, earliest first. */
  accepted: Evidence[];
  unresolved: EvidenceCandidate[];
  rejectedByAuthority: Evidence[];
}

interface Aggregate {
  results: RuleResult[];
  failures: RuleResult[];
  contested: string[];
  uncertainRules: RuleResult[];
  missingRules: RuleResult[];
  verdict: Verdict;
}

export function evaluateExecution(input: EngineInput): EngineResult {
  const { protocol, mode } = input;
  const engineVersion = input.engineVersion ?? ENGINE_VERSION;
  const unresolvedIn = input.unresolved ?? [];
  const ambiguities = input.ambiguities ?? [];
  const items: UncertaintyItem[] = [...ambiguities];

  // ── Phase 2: evidence validation ────────────────────────────────────────────
  const facts = new Map<string, StateFacts>(protocol.states.map((s) => [s.id, { accepted: [], unresolved: [], rejectedByAuthority: [] }]));
  const usable: Evidence[] = [];
  for (const e of [...input.evidence].sort(byTimeThenId)) {
    const f = facts.get(e.semantic_state);
    if (!f) continue; // unknown state: preserved upstream, ignored for protocol semantics
    if (!hasProvenance(e)) {
      items.push({ kind: "PROVENANCE_INCOMPLETE", state: e.semantic_state, rule_ids: [], refs: [e.evidence_id], material: true, detail: `Evidence ${e.evidence_id} lacks traceable provenance.` });
      continue;
    }
    const allowed = protocol.evidenceRequirements[e.semantic_state]?.acceptedAuthority;
    if (allowed && !allowed.includes(MODE_TO_PWPS_AUTHORITY[e.interpretation_mode])) {
      f.rejectedByAuthority.push(e);
      items.push({
        kind: "AUTHORITY_NOT_ACCEPTED",
        state: e.semantic_state,
        rule_ids: [],
        refs: [e.evidence_id],
        material: true,
        detail: `${stateLabel(protocol, e.semantic_state)} evidence mode ${e.interpretation_mode} is not accepted by the protocol.`,
      });
      continue;
    }
    f.accepted.push(e);
    usable.push(e);
  }
  for (const c of [...unresolvedIn].sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at) || a.candidate_id.localeCompare(b.candidate_id))) {
    facts.get(c.semantic_state)?.unresolved.push(c);
  }

  // ── Phase 3: observed timeline ──────────────────────────────────────────────
  const forbiddenStates = new Set(protocol.rules.flatMap((r) => (r.kind === "FORBIDDEN_STATE" ? [r.state] : [])));
  const coverageOf = (zone: string | undefined): CoverageStatus => {
    if (!zone) return "HEALTHY";
    if (!input.coverage) return "HEALTHY";
    return input.coverage[zone] ?? "UNKNOWN";
  };
  const timeline: Timeline = {};
  for (const s of protocol.states) {
    const f = facts.get(s.id)!;
    const first = f.accepted[0];
    if (first) {
      timeline[s.id] = { status: "PRESENT", at: toMs(first.occurred_at), precisionMs: first.time_precision_ms ?? 0, refs: f.accepted.map((e) => e.evidence_id) };
    } else if (f.unresolved.length || f.rejectedByAuthority.length) {
      timeline[s.id] = { status: "UNRESOLVED", reason: "UNRESOLVED_EVIDENCE", refs: [...f.unresolved.map((c) => c.candidate_id), ...f.rejectedByAuthority.map((e) => e.evidence_id)] };
    } else if ((s.required || forbiddenStates.has(s.id)) && coverageOf(s.zone) !== "HEALTHY") {
      timeline[s.id] = { status: "UNRESOLVED", reason: "COVERAGE_GAP" };
      items.push({
        kind: "COVERAGE_GAP",
        state: s.id,
        rule_ids: [],
        refs: [],
        material: true,
        detail: `${stateLabel(protocol, s.id)} not observed while coverage of zone "${s.zone}" is ${coverageOf(s.zone)}; absence cannot be trusted.`,
      });
    } else {
      timeline[s.id] = { status: "ABSENT" };
    }
  }

  // ── Phases 4–7: rule evaluation over the timeline ──────────────────────────
  const baseline = aggregate(protocol, timeline, items);

  // ── Phase 8: does unresolved ambiguity affect present states? ──────────────
  for (const s of protocol.states) {
    const f = facts.get(s.id)!;
    const present = timeline[s.id];
    if (present?.status !== "PRESENT") {
      if (f.unresolved.length) {
        const affected = baseline.results.filter((r) => r.states.includes(s.id) && r.status === "NOT_EVALUABLE" && r.reason === "UNRESOLVED_EVIDENCE");
        items.push({
          kind: "UNRESOLVED_CANDIDATE",
          state: s.id,
          rule_ids: affected.map((r) => r.rule_id),
          refs: f.unresolved.map((c) => c.candidate_id),
          material: protocol.stateIndex[s.id]!.required || forbiddenStates.has(s.id) || affected.some((r) => r.severity === "MANDATORY"),
          detail: `Potential ${stateLabel(protocol, s.id)} evidence could not be verified reliably.`,
        });
      }
      continue;
    }
    for (const c of f.unresolved) {
      const candAt = toMs(c.occurred_at);
      if (candAt >= present.at) {
        items.push({ kind: "UNRESOLVED_CANDIDATE", state: s.id, rule_ids: [], refs: [c.candidate_id], material: false, detail: `Later unresolved ${stateLabel(protocol, s.id)} candidate cannot change any rule.` });
        continue;
      }
      const alt: Timeline = { ...timeline, [s.id]: { ...present, at: candAt, precisionMs: c.time_precision_ms ?? 0 } };
      const altResults = evaluateRules(protocol, alt);
      const flipped = altResults.filter((r, i) => r.severity === "MANDATORY" && r.status !== baseline.results[i]!.status).map((r) => r.rule_id);
      items.push({
        kind: "UNRESOLVED_CANDIDATE",
        state: s.id,
        rule_ids: flipped,
        refs: [c.candidate_id],
        material: flipped.length > 0,
        detail: flipped.length
          ? `An earlier unresolved ${stateLabel(protocol, s.id)} candidate would change ${flipped.join(", ")} if confirmed.`
          : `Earlier unresolved ${stateLabel(protocol, s.id)} candidate does not change any mandatory rule.`,
      });
    }
  }

  // ── Phase 9: verdict selection (with contested failures) ───────────────────
  const final = aggregate(protocol, timeline, items);
  const verdict = final.verdict;

  // ── Assemble output ─────────────────────────────────────────────────────────
  const ruleResults: RuleEvaluation[] = final.results.map((r) => {
    const rule = protocol.rules.find((x) => x.id === r.rule_id)!;
    const ex = explainRule(protocol, rule, r);
    const contested = final.contested.includes(r.rule_id);
    return {
      rule_id: r.rule_id,
      operator: r.operator,
      kind: r.kind,
      severity: r.severity,
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
      states: r.states,
      expected: r.expected,
      observed: Object.fromEntries(Object.entries(r.observed).map(([k, v]) => [k, typeof v === "number" ? toIso(v) : v])),
      ...(r.delta_ms !== undefined ? { delta_ms: r.delta_ms } : {}),
      ...(r.limit_ms !== undefined ? { limit_ms: r.limit_ms } : {}),
      evidence_refs: r.states.flatMap((s) => {
        const t = timeline[s];
        return t && t.status !== "ABSENT" && t.refs?.length ? [t.refs[0]!] : [];
      }),
      explanation_code: contested ? "FAIL_CONTESTED" : ex.code,
      explanation: contested ? `${ex.text} Contested: an unresolved earlier candidate could reverse this result.` : ex.text,
    };
  });

  const failures = [...final.failures].sort(
    (a, b) => (FAILURE_PRIORITY[a.kind] ?? 9) - (FAILURE_PRIORITY[b.kind] ?? 9) || ruleOrder(protocol, a.rule_id) - ruleOrder(protocol, b.rule_id),
  );
  const primary = failures.slice(0, 1).map((r) => r.rule_id);
  const secondary = failures.slice(1).map((r) => r.rule_id);

  const observed: ObservedStep[] = protocol.states
    .flatMap((s) => {
      const t = timeline[s.id];
      if (t?.status !== "PRESENT") return [];
      const ev = facts.get(s.id)!.accepted[0]!;
      return [{ state: s.id, at: t.at, idx: s.index, ev }];
    })
    .sort((a, b) => a.at - b.at || a.idx - b.idx)
    .map((x) => ({ state: x.state, occurred_at: toIso(x.at), evidence_id: x.ev.evidence_id, interpretation_mode: x.ev.interpretation_mode }));

  const missingStates = protocol.requiredStates.filter((s) => timeline[s]?.status === "ABSENT");
  const unresolvedStates = protocol.states.filter((s) => timeline[s.id]?.status === "UNRESOLVED").map((s) => s.id);
  const potential = mode === "PROVISIONAL"
    ? protocol.rules.flatMap((r) => (r.kind === "PRECEDENCE" && r.severity === "MANDATORY" && timeline[r.first]?.status === "ABSENT" && timeline[r.second]?.status === "PRESENT" ? [r.id] : []))
    : [];
  const complete =
    protocol.requiredStates.every((s) => timeline[s]?.status === "PRESENT") &&
    (protocol.terminalStates.length === 0 || protocol.terminalStates.some((s) => timeline[s]?.status === "PRESENT"));

  const integrity: IntegrityState =
    verdict === "DEVIATED" ? "DEVIATION_DETECTED"
    : verdict === "UNCERTAIN" ? "EVIDENCE_UNRESOLVED"
    : verdict === "SEALED" ? "VERIFIED"
    : potential.length ? "POTENTIAL_ORDER_VIOLATION"
    : mode === "PROVISIONAL" ? "VALID_SO_FAR"
    : "WAITING_FOR_EVIDENCE";

  const materialItems = items.filter((i) => i.material);
  const explanation = explainVerdict(protocol, verdict, ruleResults, primary, missingStates, materialItems);
  const counterfactual = verdict === "DEVIATED" && primary[0] ? computeCounterfactual(protocol, timeline, items, primary[0]) : undefined;

  const evidenceSetHash = hashEvidenceSet(usable);
  const inputHash = hashCanonical({
    engine_version: engineVersion,
    protocol_hash: protocol.hash,
    mode,
    evidence_set_hash: evidenceSetHash,
    unresolved: unresolvedIn.map((c) => [c.candidate_id, c.semantic_state, c.occurred_at, c.status]).sort(),
    coverage: input.coverage ?? null,
    ambiguities: ambiguities.map((a) => [a.kind, a.state ?? "", a.refs.join(",")]).sort(),
  });

  return {
    engine_version: engineVersion,
    protocol_ref: protocol.ref,
    protocol_hash: protocol.hash,
    evidence_set_hash: evidenceSetHash,
    input_hash: inputHash,
    mode,
    expected_sequence: protocol.expectedSequence,
    observed_sequence: observed,
    rule_results: ruleResults,
    missing_states: missingStates,
    unresolved_states: unresolvedStates,
    uncertainty_items: items,
    primary_failures: primary,
    secondary_failures: secondary,
    potential_violations: potential,
    verdict,
    integrity_state: integrity,
    complete,
    explanation,
    ...(counterfactual ? { counterfactual } : {}),
  };
}

/** Rule evaluation + SEQSEAL verdict precedence: DEVIATED > UNCERTAIN > INCOMPLETE > SEALED. */
function aggregate(protocol: CompiledProtocol, timeline: Timeline, items: UncertaintyItem[]): Aggregate {
  const results = evaluateRules(protocol, timeline);
  const mandatory = results.filter((r) => r.severity === "MANDATORY");
  const contestedIds = new Set(items.filter((i) => i.material && i.kind === "UNRESOLVED_CANDIDATE").flatMap((i) => i.rule_ids));

  const failures = mandatory.filter((r) => r.status === "FAIL" && !contestedIds.has(r.rule_id));
  const contested = mandatory.filter((r) => r.status === "FAIL" && contestedIds.has(r.rule_id)).map((r) => r.rule_id);
  const uncertainRules = mandatory.filter((r) => r.status === "NOT_EVALUABLE" && UNCERTAIN_REASONS.has(r.reason ?? ""));
  const missingRules = mandatory.filter(
    (r) =>
      r.status === "NOT_EVALUABLE" &&
      r.reason === "MISSING_EVIDENCE" &&
      // Only required operands make absence material; optional states may legitimately never occur.
      r.states.some((s) => r.observed[s] === null && protocol.stateIndex[s]?.required),
  );
  const material = items.some((i) => i.material);

  const verdict: Verdict = failures.length
    ? "DEVIATED"
    : uncertainRules.length || contested.length || material
      ? "UNCERTAIN"
      : missingRules.length || protocol.requiredStates.some((s) => timeline[s]?.status !== "PRESENT")
        ? "INCOMPLETE"
        : "SEALED";

  return { results, failures, contested, uncertainRules, missingRules, verdict };
}

function computeCounterfactual(protocol: CompiledProtocol, timeline: Timeline, items: UncertaintyItem[], ruleId: string): Counterfactual | undefined {
  const rule = protocol.rules.find((r) => r.id === ruleId);
  if (!rule) return undefined;
  const L = (s: string) => stateLabel(protocol, s);
  if (rule.kind === "PRECEDENCE") {
    const a = timeline[rule.first];
    const b = timeline[rule.second];
    if (a?.status !== "PRESENT" || b?.status !== "PRESENT") return undefined;
    const alt: Timeline = { ...timeline, [rule.first]: { ...a, at: b.at }, [rule.second]: { ...b, at: a.at } };
    const v = aggregate(protocol, alt, items).verdict;
    return { rule_id: ruleId, statement: `If ${L(rule.first)} had occurred before ${L(rule.second)}, ${ruleId} would have passed.`, verdict_if_changed: v };
  }
  if (rule.kind === "WITHIN") {
    const a = timeline[rule.anchor];
    const t = timeline[rule.target];
    if (a?.status !== "PRESENT" || t?.status !== "PRESENT") return undefined;
    const alt: Timeline = { ...timeline, [rule.target]: { ...t, at: a.at + Math.min(rule.maxMs, Math.max(1, t.at - a.at)) } };
    const v = aggregate(protocol, alt, items).verdict;
    return { rule_id: ruleId, statement: `If ${L(rule.target)} had occurred within the ${rule.duration} limit after ${L(rule.anchor)}, ${ruleId} would have passed.`, verdict_if_changed: v };
  }
  return undefined;
}

function explainVerdict(
  protocol: CompiledProtocol,
  verdict: Verdict,
  rules: RuleEvaluation[],
  primary: string[],
  missing: string[],
  material: UncertaintyItem[],
): string {
  switch (verdict) {
    case "SEALED":
      return "All mandatory protocol constraints are satisfied by accepted evidence.";
    case "DEVIATED": {
      const r = rules.find((x) => x.rule_id === primary[0]);
      return r ? `${r.explanation} (${r.rule_id})` : "Accepted evidence proves a protocol violation.";
    }
    case "INCOMPLETE":
      return missing.length
        ? `Required ${missing.map((s) => stateLabel(protocol, s)).join(", ")} evidence has not been observed.`
        : "Required evidence is not complete yet.";
    case "UNCERTAIN": {
      const first = material[0];
      if (first) return first.detail;
      const r = rules.find((x) => x.status === "NOT_EVALUABLE" && x.reason && x.reason !== "MISSING_EVIDENCE");
      return r ? `${r.explanation} (${r.rule_id})` : "Evidence cannot support reliable automated verification.";
    }
  }
}

function hasProvenance(e: Evidence): boolean {
  return (
    e.observation_refs.length > 0 &&
    e.source_refs.length > 0 &&
    e.source_refs.every((s) => !!s.source_profile && (!!s.source_event_ref || !!s.media_session_ref || !!s.request_ref)) &&
    !Number.isNaN(Date.parse(e.occurred_at))
  );
}

function byTimeThenId(a: Evidence, b: Evidence): number {
  return toMs(a.occurred_at) - toMs(b.occurred_at) || a.evidence_id.localeCompare(b.evidence_id);
}

function ruleOrder(p: CompiledProtocol, id: string): number {
  return p.rules.find((r) => r.id === id)?.order ?? Number.MAX_SAFE_INTEGER;
}

/** Canonical, order-independent hash of the authoritative evidence set (Doc 03 §76). */
export function hashEvidenceSet(evidence: Evidence[]): string {
  const canonical = [...evidence]
    .map((e) => ({
      evidence_id: e.evidence_id,
      semantic_state: e.semantic_state,
      occurred_at: e.occurred_at,
      time_precision_ms: e.time_precision_ms ?? 0,
      interpretation_mode: e.interpretation_mode,
      observation_refs: [...e.observation_refs].sort(),
      source_refs: e.source_refs,
      quality: e.quality ?? null,
      model_id: e.model_id ?? null,
      review_id: e.review_id ?? null,
      resolver_version: e.resolver_version,
    }))
    .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  return hashCanonical(canonical);
}
