import { decide } from "@seqseal/action-policy-core";
import { evaluateExecution } from "@seqseal/engine-core";
import type { SeqSealReceipt } from "@seqseal/contracts";
import type { PipelineConfig } from "./pipeline";
import { verifyReceiptHash } from "./receipt";
import type { SeqSealStore } from "./store/repository";

export interface ReplayCheck {
  receipt_id: string;
  receipt_hash_valid: boolean;
  protocol_hash_match: boolean;
  policy_hash_match: boolean;
  evidence_set_hash_match: boolean;
  verdict_match: boolean;
  action_match: boolean;
  replayed: { verdict: string; action: string; evidence_set_hash: string };
  original: { verdict: string; action: string; evidence_set_hash: string };
  consistent: boolean;
}

/**
 * Replay contract (Doc 03 §78): same protocol hash + same evidence set + same engine
 * version → same verdict; plus same action-policy hash → same action.
 */
export async function replayReceipt(store: SeqSealStore, config: PipelineConfig, receipt: SeqSealReceipt): Promise<ReplayCheck> {
  const snapshot = await store.getSnapshot(receipt.evaluation_id);
  const evaluation = await store.getEvaluation(receipt.evaluation_id);
  if (!snapshot || !evaluation) throw new Error(`No evaluation snapshot for ${receipt.evaluation_id}`);
  const result = evaluateExecution({
    protocol: config.protocol,
    evidence: snapshot.evidence,
    unresolved: snapshot.unresolved,
    coverage: snapshot.coverage,
    ambiguities: snapshot.ambiguities,
    mode: snapshot.mode,
    engineVersion: snapshot.engine_version,
  });
  const outcome = decide({ evaluation: { ...evaluation, ...result }, policy: config.policy, now: receipt.generated_at });
  const action = outcome.kind === "DECISION" ? outcome.decision.action : outcome.mapped_action;
  const check: ReplayCheck = {
    receipt_id: receipt.receipt_id,
    receipt_hash_valid: verifyReceiptHash(receipt),
    protocol_hash_match: config.protocol.hash === receipt.protocol_hash,
    policy_hash_match: config.policy.hash === receipt.action_policy_hash,
    evidence_set_hash_match: result.evidence_set_hash === receipt.evidence_set_hash,
    verdict_match: result.verdict === receipt.verdict,
    action_match: action === receipt.operational_action,
    replayed: { verdict: result.verdict, action, evidence_set_hash: result.evidence_set_hash },
    original: { verdict: receipt.verdict, action: receipt.operational_action, evidence_set_hash: receipt.evidence_set_hash },
    consistent: false,
  };
  check.consistent =
    check.receipt_hash_valid && check.protocol_hash_match && check.policy_hash_match && check.evidence_set_hash_match && check.verdict_match && check.action_match;
  return check;
}
