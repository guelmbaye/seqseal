import { canonicalJson, sha256Hex } from "@pwps/core";

export { canonicalJson, sha256Hex };

/** `sha256:` + hex digest of the canonical JSON form of any value. */
export function hashCanonical(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/** Short deterministic id fragment derived from a set of parts. */
export function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${sha256Hex(parts.join("\u0001")).slice(0, 16)}`;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function toMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid timestamp: ${iso}`);
  return ms;
}

export function pad(n: number, width = 4): string {
  return String(n).padStart(width, "0");
}

export function assertNever(x: never, msg = "Unexpected value"): never {
  throw new Error(`${msg}: ${JSON.stringify(x)}`);
}
