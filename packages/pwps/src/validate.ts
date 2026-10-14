import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { PwpsIssue } from "./errors";
import { parsePwpsSource, type ParseOptions } from "./parser";
import { validateSemantics } from "./semantic";
import { validateStructure } from "./structural";
import { normalizePwps } from "./canonicalize";
import type { PwpsDocument, ValidationMode } from "./types";

export interface ValidateOptions extends ParseOptions {
  /** `strict` (default) rejects unknown core properties; `compatible` ignores them with a warning. */
  mode?: ValidationMode;
}

export interface ValidationResult {
  valid: boolean;
  errors: PwpsIssue[];
  warnings: PwpsIssue[];
  /** Normalized document (only when valid). */
  document?: PwpsDocument;
}

/**
 * Full validation pipeline: parse (if text) → structural (JSON Schema) → semantic.
 * Semantic validation runs only when the structure is sound.
 */
export function validatePwps(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const mode = options.mode ?? "strict";
  let value = input;
  if (typeof input === "string") {
    const parsed = parsePwpsSource(input, options);
    if (!parsed.ok) return { valid: false, errors: parsed.issues, warnings: [] };
    value = parsed.value;
  }

  const structural = validateStructure(value, mode);
  const sErrors = structural.issues.filter((i) => i.severity === "error");
  const sWarnings = structural.issues.filter((i) => i.severity === "warning");
  if (sErrors.length > 0) return { valid: false, errors: sErrors, warnings: sWarnings };

  const doc = value as PwpsDocument;
  const semantic = validateSemantics(doc);
  const errors = semantic.filter((i) => i.severity === "error");
  const warnings = [...sWarnings, ...semantic.filter((i) => i.severity === "warning")];
  if (errors.length > 0) return { valid: false, errors, warnings };
  return { valid: true, errors: [], warnings, document: normalizePwps(doc) };
}

/** Read and validate a PWPS file (`.yaml`, `.yml` or `.json`). */
export function validatePwpsFile(path: string, options: ValidateOptions = {}): ValidationResult & { source: string } {
  const source = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  const format = ext === ".json" ? "json" : ext === ".yaml" || ext === ".yml" ? "yaml" : "auto";
  return { ...validatePwps(source, { format, ...options }), source };
}
