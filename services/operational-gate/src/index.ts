/**
 * operational-gate — applies an authorized OperationalDecision to the Receiving Workflow
 * projection with conditional (idempotent) writes and emits WorkflowReleased / WorkflowHeld /
 * WorkflowReviewRequired / WorkflowAwaitingEvidence. Does not interpret protocol rules.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("operational-gate", ["OperationalDecisionCreated"]);
