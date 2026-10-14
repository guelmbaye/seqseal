import { parse as parseYaml, YAMLParseError } from "yaml";
import { issue, type PwpsIssue } from "./errors";

export interface ParseOptions {
  /** Input format. `auto` detects JSON by a leading `{`. */
  format?: "auto" | "yaml" | "json";
  /** Maximum document size in bytes (default 1 MiB). */
  maxBytes?: number;
  /** Maximum nesting depth (default 32). */
  maxDepth?: number;
}

export type ParseResult = { ok: true; value: unknown; format: "yaml" | "json" } | { ok: false; issues: PwpsIssue[] };

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_DEPTH = 32;

/**
 * Parse a PWPS document from YAML or JSON source text.
 *
 * Security (SPEC §12): documents may come from untrusted sources, so the parser
 * enforces size/depth limits, rejects duplicate keys, caps YAML aliases
 * (no "billion laughs") and only uses the YAML core schema (no custom tags,
 * nothing executable).
 */
export function parsePwpsSource(source: string, options: ParseOptions = {}): ParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > maxBytes) {
    return { ok: false, issues: [issue("PWPS-E070", `Document is ${bytes} bytes; limit is ${maxBytes}.`)] };
  }
  const trimmed = source.replace(/^\uFEFF/, "").trimStart();
  const format = options.format && options.format !== "auto" ? options.format : trimmed.startsWith("{") ? "json" : "yaml";

  let value: unknown;
  try {
    if (format === "json") {
      value = JSON.parse(trimmed);
    } else {
      value = parseYaml(trimmed, {
        schema: "core",
        strict: true,
        uniqueKeys: true,
        maxAliasCount: 100,
        prettyErrors: true,
      });
    }
  } catch (err) {
    const msg = err instanceof YAMLParseError || err instanceof SyntaxError ? err.message : String(err);
    return { ok: false, issues: [issue("PWPS-E080", msg.split("\n")[0])] };
  }

  const depth = measureDepth(value, 0, maxDepth + 1);
  if (depth > maxDepth) {
    return { ok: false, issues: [issue("PWPS-E070", `Document nesting exceeds ${maxDepth} levels.`)] };
  }
  return { ok: true, value, format };
}

function measureDepth(value: unknown, current: number, stopAt: number): number {
  if (current >= stopAt) return current;
  if (Array.isArray(value)) {
    let max = current;
    for (const v of value) max = Math.max(max, measureDepth(v, current + 1, stopAt));
    return max;
  }
  if (value !== null && typeof value === "object") {
    let max = current;
    for (const v of Object.values(value)) max = Math.max(max, measureDepth(v, current + 1, stopAt));
    return max;
  }
  return current;
}
