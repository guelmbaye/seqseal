export * from "./signature";
export * from "./envelope";
export * from "./normalize";
export * from "./playground";
export * from "./api-client";
export * from "./replay";

import type { RawSourceRecord } from "@seqseal/contracts";
import { normalizeRingRecord, type NormalizeOutcome } from "./normalize";
import { isPlaygroundCapture, normalizePlaygroundRecord } from "./playground";

/**
 * Single entry point used by the pipeline: dispatch on source profile. A Ring-derived replay
 * carries either a saved Playground capture or a saved Ring webhook envelope.
 */
export function normalizeSourceRecord(record: RawSourceRecord): NormalizeOutcome {
  if (record.source_profile === "RING_PLAYGROUND") return normalizePlaygroundRecord(record);
  if (record.source_profile === "RING_DERIVED_REPLAY" && isPlaygroundCapture(record.payload)) return normalizePlaygroundRecord(record);
  return normalizeRingRecord({ record });
}
