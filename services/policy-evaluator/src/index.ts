/**
 * policy-evaluator — Action Policy Engine: Verdict + versioned ActionPolicy → OperationalDecision.
 * Never re-evaluates evidence. RELEASE ⇒ SEALED is enforced in code, at activation and here.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("policy-evaluator", ["WorkflowEvaluated"]);
