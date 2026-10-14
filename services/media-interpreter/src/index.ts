/**
 * media-interpreter — the ONLY function allowed to invoke Amazon Bedrock.
 * Output: an evidence candidate (SUPPORTED / NOT_SUPPORTED / AMBIGUOUS) for the state the
 * deterministic mapping proposed. Model failure, malformed output or missing media leave the
 * evidence unresolved → UNCERTAIN → REVIEW. Never RELEASE.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("media-interpreter", ["EvidenceInterpretationRequested"]);
