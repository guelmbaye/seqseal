import AjvImport, { type ErrorObject, type ValidateFunction } from "ajv";
import schema from "../schema/pwps-0.1.schema.json";
import { issue, type PwpsIssue } from "./errors";
import type { ValidationMode } from "./types";

type AjvCtor = new (opts: Record<string, unknown>) => {
  compile: (s: unknown) => ValidateFunction;
};
const Ajv: AjvCtor =
  ((AjvImport as unknown as { default?: AjvCtor }).default ?? (AjvImport as unknown as AjvCtor));

let compiled: ValidateFunction | undefined;
function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    compiled = ajv.compile(schema);
  }
  return compiled;
}

export interface StructuralResult {
  issues: PwpsIssue[];
  /** Instance paths of unknown properties (compatible mode strips them). */
  unknownProperties: string[];
}

/** Structural validation against the published JSON Schema (SPEC §11). */
export function validateStructure(value: unknown, mode: ValidationMode): StructuralResult {
  const validate = validator();
  validate(value);
  const errors = (validate.errors ?? []).filter(isReportable);
  const issues: PwpsIssue[] = [];
  const unknownProperties: string[] = [];
  const seen = new Set<string>();

  for (const err of errors) {
    const path = err.instancePath || "/";
    if (err.keyword === "additionalProperties") {
      const prop = String((err.params as { additionalProperty?: string }).additionalProperty);
      const full = `${err.instancePath}/${prop}`;
      unknownProperties.push(full);
      if (mode === "strict") push(issue("PWPS-E005", `Unknown property "${prop}"`, full));
      else push(issue("PWPS-W010", `Unknown property "${prop}" ignored`, full));
      continue;
    }
    push(mapError(err, path));
  }
  return { issues, unknownProperties };

  function push(i: PwpsIssue) {
    const key = `${i.code}|${i.path}|${i.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      issues.push(i);
    }
  }
}

/** `if/then` wrappers produce noise; keep only actionable errors. */
function isReportable(err: ErrorObject): boolean {
  return err.keyword !== "if" && err.keyword !== "allOf";
}

function mapError(err: ErrorObject, path: string): PwpsIssue {
  const params = err.params as Record<string, unknown>;
  if (err.keyword === "required") {
    const missing = String(params.missingProperty);
    if (path === "/protocol" && missing === "id") return issue("PWPS-E001", undefined, "/protocol/id");
    return issue("PWPS-E004", `Missing required property "${missing}"`, `${path === "/" ? "" : path}/${missing}`);
  }
  if (path === "/pwps") {
    return issue("PWPS-E003", `Unsupported PWPS version; this implementation understands "0.1"`, path);
  }
  if (path === "/protocol/version") return issue("PWPS-E002", undefined, path);
  if (/\/operator$/.test(path) && err.keyword === "enum") {
    return issue("PWPS-E050", `Unsupported operator; PWPS 0.1 supports REQUIRED, BEFORE, AFTER, WITHIN, FORBIDDEN`, path);
  }
  if (/\/duration$/.test(path)) return issue("PWPS-E030", undefined, path);
  if (err.keyword === "pattern" && /\/(id|state|reference|after|zone|from|to)$/.test(path)) {
    return issue("PWPS-E013", `Invalid identifier: must match ${String(params.pattern)}`, path);
  }
  return issue("PWPS-E004", `${err.message ?? "schema violation"}`, path);
}
