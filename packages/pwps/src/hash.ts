import { createHash } from "node:crypto";
import { canonicalizePwps } from "./canonicalize";
import type { PwpsDocument } from "./types";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Content identity of a protocol: `sha256:` + hex(SHA-256(canonical JSON)).
 *
 * A hash establishes WHAT the protocol says, not WHO authored or approved it
 * (SPEC §12.3). Formatting, comments, YAML vs JSON and key order do not change it.
 */
export function hashPwps(doc: PwpsDocument): string {
  return `sha256:${sha256Hex(canonicalizePwps(doc))}`;
}
