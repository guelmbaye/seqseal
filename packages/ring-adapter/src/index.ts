export * from "./signature";
export * from "./envelope";
export * from "./normalize";
export * from "./playground";
export * from "./api-client";
export * from "./replay";

import type { RawSourceRecord } from "@seqseal/contracts";
import { normalizeRingRecord, type NormalizeOutcome } from "./normalize";
import { normalizePlaygroundRecord } from "./playground";

/** Single entry point used by the pipeline: dispatch on source profile. */
export function normalizeSourceRecord(record: RawSourceRecord): NormalizeOutcome {
  return record.source_profile === "RING_PLAYGROUND" ? normalizePlaygroundRecord(record) : normalizeRingRecord({ record });
}
