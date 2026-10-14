/**
 * evidence-resolver — Observation → deterministic evidence candidate → acceptance policy →
 * execution correlation. Routes to AI interpretation only when a mapping explicitly says so.
 * Has no authority to issue verdicts or actions.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("evidence-resolver", ["ObservationNormalized"]);
