/** observation-normalizer — Ring raw source record → vendor-neutral NormalizedObservation (+ zone binding, source health). */
import { sqsStage } from "@seqseal/aws";

export const handler = sqsStage("observation-normalizer", ["RingSourceEventReceived"]);
