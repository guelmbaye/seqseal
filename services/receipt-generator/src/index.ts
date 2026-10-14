/**
 * receipt-generator — builds the SeqSeal Receipt once a FINAL decision was actually applied
 * by the Operational Gate; stores canonical JSON in S3 and metadata in DynamoDB.
 */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("receipt-generator", ["ActionApplied"]);
