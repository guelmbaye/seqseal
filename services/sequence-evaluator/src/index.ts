/**
 * sequence-evaluator — wraps the pure Sequence Integrity Engine (Doc 06 §49).
 * Loads execution + accepted evidence + coverage, evaluates PWPS, persists the evaluation
 * and its input snapshot, publishes WorkflowEvaluated. Consumes protocol-evaluation-q and
 * the delayed finalization-q. Its IAM role has an explicit Deny on bedrock:* — verdict
 * authority is deterministic by infrastructure, not by prompt.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("sequence-evaluator", [
  "EvidenceAccepted",
  "EvidenceUnresolved",
  "EvidenceReviewed",
  "CorrelationAmbiguityDetected",
  "SourceHealthChanged",
  "ExecutionFinalizationRequested",
]);
