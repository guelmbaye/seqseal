import type { ExecutionDetail, ExplanationLink, ProtocolView } from "./types";
import { SOURCE_LABEL } from "./types";

/**
 * Receiving checklist view model (Master Brief §2–5, §38).
 *
 * Pure derivation from what the pipeline recorded: rows come from accepted evidence (the
 * engine's observed sequence) and unresolved candidates; the Release button comes from the
 * ReceivingWorkflow status the Operational Gate applied. Nothing here decides anything.
 */

/** Hero protocol (§10): the first three states of the expected sequence carry the demo. */
export const HERO_STATE_COUNT = 3;

export type RowStatus = "checked" | "unresolved" | "open";
export interface ChecklistRow {
  state: string;
  label: string;
  at?: string;
  status: RowStatus;
  /** Part of the failed rule (shown amber when revealed). */
  flagged: boolean;
  /** Part of the protocol's signature rule, e.g. ORDER-02's STAGING and STORAGE. */
  signature: boolean;
}
export type Tone = "seal" | "hold" | "wait" | "review" | "none";
export interface ReleaseView {
  locked: boolean;
  tone: Tone;
  reason: string;
  detail?: string;
}
export interface WhyView {
  title: string;
  passed: boolean;
  expected: string;
  observed: string;
}
export interface ChecklistView {
  executionId: string;
  source: string;
  sourceProfile?: string;
  rows: ChecklistRow[];
  also: ChecklistRow[];
  allChecked: boolean;
  release: ReleaseView;
  why?: WhyView;
  chain?: ExplanationLink[];
  receiptId?: string;
  active: boolean;
}

const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : "");
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function checklistView(d: ExecutionDetail, p: ProtocolView): ChecklistView {
  const ev = d.evaluation;
  const label = (s: string) => title(p.labels[s] ?? s);
  const heroStates = p.expected_sequence.slice(0, HERO_STATE_COUNT);
  const primary = ev?.verdict === "DEVIATED" ? ev.rule_results.find((r) => r.rule_id === ev.primary_failures[0]) : undefined;
  const flaggedStates = new Set(primary?.states ?? []);
  const signatureStates = new Set(ev?.rule_results.find((r) => r.rule_id === p.signature_rule)?.states ?? []);

  const observed = new Map((ev?.observed_sequence ?? []).map((s) => [s.state, s.occurred_at]));
  const unresolved = new Map<string, string>();
  for (const c of d.candidates) {
    if ((c.status === "UNCERTAIN" || c.status === "MEDIA_PENDING") && !observed.has(c.semantic_state) && !unresolved.has(c.semantic_state)) {
      unresolved.set(c.semantic_state, c.occurred_at);
    }
  }
  const rowFor = (s: string): ChecklistRow => {
    const at = observed.get(s) ?? unresolved.get(s);
    const status: RowStatus = observed.has(s) ? "checked" : unresolved.has(s) ? "unresolved" : "open";
    return { state: s, label: label(s), ...(at ? { at } : {}), status, flagged: flaggedStates.has(s), signature: signatureStates.has(s) };
  };
  // Seen rows in the order they physically happened, then the steps still open in protocol order.
  const sortSeen = (states: string[]) => {
    const seen = states.filter((s) => observed.has(s) || unresolved.has(s)).map(rowFor);
    seen.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || p.expected_sequence.indexOf(a.state) - p.expected_sequence.indexOf(b.state));
    return [...seen, ...states.filter((s) => !observed.has(s) && !unresolved.has(s)).map(rowFor)];
  };
  const rows = sortSeen(heroStates);
  const also = sortSeen(p.expected_sequence.slice(HERO_STATE_COUNT));

  const status = d.workflow?.status ?? "PENDING";
  const active = d.execution.status === "ACTIVE";
  const missing = (ev?.missing_states ?? []).map(label);
  const material = ev?.uncertainty_items.find((i) => i.material);
  let release: ReleaseView;
  switch (status) {
    case "RELEASED": {
      const h = [...(d.workflow?.history ?? [])].reverse().find((x) => x.to === "RELEASED");
      release = { locked: false, tone: "seal", reason: "Steps happened in the required order", ...(h ? { detail: `Released ${h.at.slice(11, 19)} UTC by ${h.event_type ?? "the Operational Gate"}` } : {}) };
      break;
    }
    case "HELD": {
      const reason =
        primary?.kind === "PRECEDENCE" ? "Wrong order" : primary?.kind === "WITHIN" ? "Outside the time limit" : primary?.kind?.startsWith("FORBIDDEN") ? "Forbidden step" : "Protocol violation";
      release = { locked: true, tone: "hold", reason, ...(primary ? { detail: `${primary.rule_id} failed` } : {}) };
      break;
    }
    case "REVIEW_REQUIRED":
      release = { locked: true, tone: "review", reason: "Needs review", ...(material ? { detail: material.detail } : {}) };
      break;
    case "WAITING":
      release = active
        ? { locked: true, tone: "wait", reason: "Checking the delivery", detail: `${(ev?.observed_sequence ?? []).length} of ${p.expected_sequence.length} steps observed` }
        : { locked: true, tone: "wait", reason: "Waiting for evidence", detail: missing.length ? `${missing.join(", ")} not observed yet` : ev?.explanation ?? "" };
      break;
    default:
      release = { locked: true, tone: "none", reason: "Checking the delivery", detail: "Waiting for Ring observations" };
  }

  return {
    executionId: d.execution.execution_id,
    source: SOURCE_LABEL[d.execution.source_profiles[0] ?? ""] ?? d.execution.source_profiles[0] ?? "No source yet",
    ...(d.execution.source_profiles[0] ? { sourceProfile: d.execution.source_profiles[0] } : {}),
    rows,
    also,
    allChecked: rows.every((r) => r.status === "checked"),
    release,
    ...(whyFor(d, p) ? { why: whyFor(d, p)! } : {}),
    ...(d.explanation_chain ? { chain: d.explanation_chain } : {}),
    ...(d.receipts.at(-1) ? { receiptId: d.receipts.at(-1)!.receipt_id } : {}),
    active,
  };
}

/** The exact rule behind the button: the failed rule, or the protocol's signature rule when it passed. */
function whyFor(d: ExecutionDetail, p: ProtocolView): WhyView | undefined {
  const ev = d.evaluation;
  if (!ev) return undefined;
  const label = (s: string) => p.labels[s] ?? s.toUpperCase();
  const ruleText = (id: string) => (p.rules.find((r) => r.id === id)?.text ?? id).replace(" must occur ", " ").replace(" is required", " is required");
  const id = ev.verdict === "DEVIATED" ? ev.primary_failures[0] : p.signature_rule;
  const r = id ? ev.rule_results.find((x) => x.rule_id === id) : undefined;

  if (ev.verdict === "INCOMPLETE") {
    const m = ev.missing_states.map(label);
    return { title: "Waiting for evidence", passed: false, expected: m.length ? `${m.join(", ")} required` : "Every required step", observed: m.length ? `${m.join(", ")} not observed yet; cameras healthy` : ev.explanation };
  }
  if (ev.verdict === "UNCERTAIN") {
    const blocked = ev.rule_results.filter((x) => x.severity === "MANDATORY" && x.status === "NOT_EVALUABLE" && x.reason !== "MISSING_EVIDENCE").map((x) => x.rule_id);
    const item = ev.uncertainty_items.find((i) => i.material);
    return { title: "Needs review", passed: false, expected: blocked.length ? `${blocked.join(", ")} must be checkable` : "Reliable evidence for every step", observed: item?.detail ?? ev.explanation };
  }
  if (!r) return undefined;
  const exp = r.expected as { before?: string; after?: string };
  let observedText = r.explanation;
  if (exp.before && exp.after) {
    const pairs = [exp.before, exp.after]
      .map((s) => ({ s, at: typeof r.observed[s] === "string" ? (r.observed[s] as string) : undefined }))
      .filter((x) => x.at)
      .sort((a, b) => a.at!.localeCompare(b.at!));
    if (pairs.length === 2) observedText = pairs.map((x) => `${label(x.s)} ${hhmm(x.at)}`).join(", ");
  }
  return {
    title: `${r.rule_id} ${r.status === "PASS" ? "passed" : r.status === "FAIL" ? "failed" : "not checkable"}`,
    passed: r.status === "PASS",
    expected: ruleText(r.rule_id),
    observed: observedText,
  };
}
