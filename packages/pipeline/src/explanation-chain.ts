import { describeRule, type CompiledProtocol } from "@pwps/core";
import type { Action, EngineResult, Evidence, ExplanationLink, SourceProfile, Verdict } from "@seqseal/contracts";

/**
 * Receipt explanation chain (Master Brief §35). Reconstructs, without any model, why the
 * workflow received its action:
 *
 *   HOLD
 *   because  Action policy IDP-ACTION@1.0.0 maps DEVIATED → HOLD
 *   because  ORDER-02 failed: STAGING must occur before STORAGE
 *   because  STORAGE 14:03 occurred before STAGING 14:06
 *   based on Ring-shaped test fixture evidence (or Ring Developer Playground evidence, …)
 *
 * Times are the physical occurrence times (UTC, HH:MM).
 */
const SOURCE_PHRASE: Record<SourceProfile, string> = {
  RING_PLAYGROUND: "Ring Developer Playground evidence",
  RING_WEBHOOK: "Ring webhook evidence",
  RING_STAGING: "Ring webhook evidence (staging app)",
  RING_DERIVED_REPLAY: "Ring-derived replay evidence",
  FIXTURE_REPLAY: "Ring-shaped test fixture evidence",
  CUSTOM_MEDIA: "custom demo media evidence (not Ring)",
};

export interface ChainInput {
  protocol: CompiledProtocol;
  evaluation: Pick<EngineResult, "verdict" | "rule_results" | "primary_failures" | "missing_states" | "uncertainty_items" | "observed_sequence">;
  action: Action;
  policyRef: string;
  evidence: Evidence[];
  decisionId?: string;
}

const hhmm = (iso: string | null | undefined) => (typeof iso === "string" ? iso.slice(11, 16) : "—");

/** The protocol's signature rule: its first declared failure condition, else its first ordering rule. */
export function signatureRule(protocol: CompiledProtocol): string | undefined {
  const fc = (protocol.document as { failure_conditions?: Array<{ constraint_ref?: string }> }).failure_conditions?.[0]?.constraint_ref;
  return fc ?? protocol.rules.find((r) => r.kind === "PRECEDENCE")?.id;
}

export function buildExplanationChain(c: ChainInput): ExplanationLink[] {
  const { protocol, evaluation: ev } = c;
  const label = (s: string) => (protocol.stateIndex[s]?.label ?? s).toUpperCase();
  const ruleText = (id: string) => {
    const rule = protocol.rules.find((r) => r.id === id);
    return rule ? describeRule(protocol, rule) : id;
  };
  const result = (id: string | undefined) => ev.rule_results.find((r) => r.rule_id === id);
  const verdict: Verdict = ev.verdict;

  const links: ExplanationLink[] = [
    { kind: "ACTION", connector: "", text: c.action, refs: c.decisionId ? [c.decisionId] : [] },
    { kind: "POLICY", connector: "because", text: `Action policy ${c.policyRef} maps ${verdict} → ${c.action}`, refs: [c.policyRef] },
  ];

  /** "STORAGE 14:03 occurred before STAGING 14:06" from a precedence result, in physical order. */
  const orderSentence = (id: string): string | undefined => {
    const r = result(id);
    const exp = r?.expected as { before?: string; after?: string } | undefined;
    if (!r || !exp?.before || !exp.after) return undefined;
    const tb = r.observed[exp.before];
    const ta = r.observed[exp.after];
    if (typeof tb !== "string" || typeof ta !== "string") return undefined;
    const [first, second] = tb <= ta ? [exp.before, exp.after] : [exp.after, exp.before];
    const t1 = first === exp.before ? tb : ta;
    const t2 = first === exp.before ? ta : tb;
    return `${label(first)} ${hhmm(t1)} occurred before ${label(second)} ${hhmm(t2)}`;
  };

  let cited: string[] = [];
  if (verdict === "DEVIATED") {
    const id = ev.primary_failures[0]!;
    const r = result(id);
    cited = r?.evidence_refs ?? [];
    links.push({ kind: "RULE", connector: "because", text: `${id} failed: ${ruleText(id)}`, refs: [id] });
    links.push({ kind: "OBSERVATION", connector: "because", text: (r?.kind === "PRECEDENCE" && orderSentence(id)) || r?.explanation || "", refs: cited });
  } else if (verdict === "SEALED") {
    const mandatory = ev.rule_results.filter((r) => r.severity === "MANDATORY");
    const sig = signatureRule(protocol);
    const r = result(sig);
    cited = [...new Set(ev.observed_sequence.map((s) => s.evidence_id))];
    links.push({
      kind: "RULE",
      connector: "because",
      text: `All ${mandatory.length} protocol rules passed${sig ? `, including ${sig}: ${ruleText(sig)}` : ""}`,
      refs: mandatory.map((m) => m.rule_id),
    });
    if (sig && r) links.push({ kind: "OBSERVATION", connector: "because", text: orderSentence(sig) ?? r.explanation, refs: r.evidence_refs });
  } else if (verdict === "INCOMPLETE") {
    const missing = ev.missing_states.map(label);
    const rules = ev.rule_results.filter((r) => r.kind === "REQUIRED" && r.reason === "MISSING_EVIDENCE").map((r) => r.rule_id);
    cited = [...new Set(ev.observed_sequence.map((s) => s.evidence_id))];
    links.push({ kind: "RULE", connector: "because", text: `${rules.join(", ") || "Required rules"} cannot pass yet: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required`, refs: rules });
    links.push({
      kind: "OBSERVATION",
      connector: "because",
      text: `${missing.join(", ")} ${missing.length > 1 ? "were" : "was"} not observed while camera coverage was healthy, so the delivery waits instead of being treated as a violation`,
      refs: [],
    });
  } else {
    const blocked = ev.rule_results.filter((r) => r.severity === "MANDATORY" && r.status === "NOT_EVALUABLE" && r.reason !== "MISSING_EVIDENCE").map((r) => r.rule_id);
    const item = ev.uncertainty_items.find((i) => i.material);
    cited = item?.refs ?? [];
    links.push({ kind: "RULE", connector: "because", text: `${blocked.join(", ") || "Protocol rules"} could not be evaluated reliably`, refs: blocked });
    links.push({ kind: "OBSERVATION", connector: "because", text: item?.detail ?? "Evidence is ambiguous or observation coverage was compromised", refs: cited });
  }

  const used = c.evidence.filter((e) => cited.includes(e.evidence_id));
  const pool = used.length ? used : c.evidence;
  const profiles = [...new Set(pool.flatMap((e) => e.source_refs.map((s) => s.source_profile)))];
  links.push({
    kind: "EVIDENCE",
    connector: "based on",
    text: profiles.length ? profiles.map((p) => SOURCE_PHRASE[p]).join(" and ") : "no accepted evidence",
    refs: pool.map((e) => e.evidence_id),
  });
  return links;
}
