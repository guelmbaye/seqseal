/**
 * Stable PWPS diagnostic codes. Codes are part of the public contract:
 * tooling MAY match on them, so they MUST NOT be renumbered.
 */
export const PWPS_CODES = {
  // Document / parsing
  "PWPS-E001": "Missing protocol identity (protocol.id)",
  "PWPS-E002": "Invalid protocol version (expected semantic version MAJOR.MINOR.PATCH)",
  "PWPS-E003": "Unsupported PWPS specification version",
  "PWPS-E004": "Structural schema violation",
  "PWPS-E005": "Unknown core property (strict mode)",
  "PWPS-E070": "Document exceeds size or nesting limits",
  "PWPS-E080": "Document could not be parsed",
  // States / zones
  "PWPS-E010": "Duplicate state id",
  "PWPS-E011": "Duplicate zone id",
  "PWPS-E012": "State references an undeclared zone",
  "PWPS-E013": "Invalid identifier format",
  // Constraints
  "PWPS-E020": "Duplicate constraint id",
  "PWPS-E021": "Constraint references an unknown state",
  "PWPS-E022": "Constraint references the same state on both sides",
  "PWPS-E023": "Transition references an unknown state",
  "PWPS-E024": "Field not applicable to this operator",
  "PWPS-E030": "Invalid ISO 8601 duration (supported designators: D, H, M, S)",
  "PWPS-E031": "Duration must be greater than zero",
  "PWPS-E040": "Contradictory required configuration",
  "PWPS-E041": "Cyclic strict ordering contradiction",
  "PWPS-E042": "Required state is also forbidden",
  "PWPS-E043": "Forbidden transition is declared as an allowed transition",
  "PWPS-E050": "Unsupported operator",
  // Evidence / uncertainty / failure conditions
  "PWPS-E060": "Evidence requirement references an unknown state",
  "PWPS-E061": "Unknown evidence authority",
  "PWPS-E062": "Failure condition references an unknown constraint",
  "PWPS-E063": "Evidence requirement references an undeclared zone",
  // Warnings
  "PWPS-W001": "State defined but never referenced by a constraint",
  "PWPS-W002": "No terminal state declared",
  "PWPS-W003": "metadata.description missing",
  "PWPS-W005": "State references a zone but no zones are declared",
  "PWPS-W010": "Unknown core property ignored (compatible mode)",
  "PWPS-W020": "Evidence requirement zone differs from the state's zone",
} as const;

export type PwpsCode = keyof typeof PWPS_CODES;

export interface PwpsIssue {
  code: PwpsCode;
  severity: "error" | "warning";
  message: string;
  /** JSON pointer-like path to the offending node, when known. */
  path?: string;
}

export function issue(code: PwpsCode, message?: string, path?: string): PwpsIssue {
  return {
    code,
    severity: code.startsWith("PWPS-W") ? "warning" : "error",
    message: message ?? PWPS_CODES[code],
    ...(path !== undefined ? { path } : {}),
  };
}

export class PwpsValidationError extends Error {
  readonly issues: PwpsIssue[];
  constructor(issues: PwpsIssue[]) {
    const first = issues.find((i) => i.severity === "error") ?? issues[0];
    super(first ? `${first.code}: ${first.message}` : "Invalid PWPS document");
    this.name = "PwpsValidationError";
    this.issues = issues;
  }
}

export function formatIssue(i: PwpsIssue): string {
  return `${i.code}${i.path ? ` (${i.path})` : ""}\n  ${i.message}`;
}
