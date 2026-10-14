import type { CompiledProtocol } from "@pwps/core";
import type { ActionPolicy } from "@seqseal/action-policy-core";
import {
  POLICY_ENGINE_VERSION,
  RECEIPT_DISCLAIMER,
  hashCanonical,
  pad,
  type Evidence,
  type Execution,
  type OperationalDecision,
  type ReceivingWorkflow,
  type SeqSealReceipt,
  type WorkflowEvaluation,
} from "@seqseal/contracts";

export interface BuildReceiptArgs {
  execution: Execution;
  evaluation: WorkflowEvaluation;
  decision: OperationalDecision;
  workflow: ReceivingWorkflow | undefined;
  protocol: CompiledProtocol;
  policy: ActionPolicy;
  evidence: Evidence[];
  version: number;
  supersedes?: string;
  now: string;
}

export function receiptIdFor(execution: Execution, version: number): string {
  const base = `SSR-${pad(execution.number)}`;
  return version === 1 ? base : `${base}-v${version}`;
}

/**
 * SeqSeal Receipt: binds protocol, evidence, rule results, verdict, action policy and the
 * APPLIED operational action into one replayable artifact (Doc 03 §60, Doc 05 §30–40).
 * The receipt only claims RELEASED/HELD when the Operational Gate confirmed application.
 */
export function buildReceipt(a: BuildReceiptArgs): SeqSealReceipt {
  const applied = !!a.workflow && a.workflow.applied_decision_ids.includes(a.decision.decision_id);
  const transition = a.workflow?.history.find((h) => h.decision_id === a.decision.decision_id);
  const evidenceIds = new Set(a.evaluation.observed_sequence.map((s) => s.evidence_id));
  for (const r of a.evaluation.rule_results) for (const id of r.evidence_refs) evidenceIds.add(id);
  const evidence = a.evidence
    .filter((e) => evidenceIds.has(e.evidence_id))
    .sort((x, y) => x.occurred_at.localeCompare(y.occurred_at) || x.evidence_id.localeCompare(y.evidence_id))
    .map((e) => ({
      evidence_id: e.evidence_id,
      state: e.semantic_state,
      occurred_at: e.occurred_at,
      interpretation_mode: e.interpretation_mode,
      observation_refs: e.observation_refs,
      source_refs: e.source_refs,
      ...(e.model_id ? { model_id: e.model_id } : {}),
      ...(e.review_id ? { review_id: e.review_id } : {}),
    }));

  const body: Omit<SeqSealReceipt, "receipt_hash"> = {
    receipt_id: receiptIdFor(a.execution, a.version),
    receipt_version: a.version,
    ...(a.supersedes ? { supersedes: a.supersedes } : {}),
    stage: applied ? "RECEIPT_FINALIZED" : "ACTION_PENDING",
    execution_id: a.execution.execution_id,
    protocol: { id: a.protocol.id, version: a.protocol.version, name: a.protocol.name, hash: a.protocol.hash },
    action_policy: { id: a.policy.id, version: a.policy.version, hash: a.policy.hash },
    engine_version: a.evaluation.engine_version,
    policy_engine_version: POLICY_ENGINE_VERSION,
    evaluation_id: a.evaluation.evaluation_id,
    evidence_set_hash: a.evaluation.evidence_set_hash,
    input_hash: a.evaluation.input_hash,
    expected_sequence: a.evaluation.expected_sequence,
    observed_sequence: a.evaluation.observed_sequence,
    rule_results: a.evaluation.rule_results.map((r) => ({
      rule_id: r.rule_id,
      status: r.status,
      ...(r.reason ? { reason: r.reason } : {}),
      explanation: r.explanation,
      evidence_refs: r.evidence_refs,
    })),
    primary_failures: a.evaluation.primary_failures,
    verdict: a.evaluation.verdict,
    explanation: a.evaluation.explanation,
    operational: {
      decision_id: a.decision.decision_id,
      action: a.decision.action,
      policy_mapping: `${a.decision.verdict} → ${a.decision.action}`,
      applied,
      workflow_status: a.workflow?.status ?? "PENDING",
      ...(transition ? { applied_at: transition.at } : applied && a.workflow ? { applied_at: a.workflow.updated_at } : {}),
      ...(transition?.event_type ? { event_type: transition.event_type } : {}),
    },
    evidence,
    source_profiles: [...new Set(evidence.flatMap((e) => e.source_refs.map((s) => s.source_profile)))],
    uncertainty_items: a.evaluation.uncertainty_items,
    generated_at: a.now,
    disclaimer: RECEIPT_DISCLAIMER,
  };
  return { ...body, receipt_hash: hashCanonical(body) };
}

/** Application-level tamper evidence: recompute the hash over the receipt body. */
export function verifyReceiptHash(r: SeqSealReceipt): boolean {
  const { receipt_hash, ...body } = r;
  return hashCanonical(body) === receipt_hash;
}
