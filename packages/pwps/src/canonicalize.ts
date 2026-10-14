import { formatDuration, parseDuration } from "./duration";
import type {
  EvidenceRequirement,
  FailureCondition,
  PwpsConstraint,
  PwpsDocument,
  PwpsState,
  PwpsTransition,
  PwpsZone,
  UncertaintyPolicy,
} from "./types";

/**
 * Deterministic canonical JSON (SPEC §10):
 *  - object keys sorted by UTF-16 code unit order,
 *  - no insignificant whitespace,
 *  - `undefined` members dropped,
 *  - non-finite numbers rejected.
 * Array order is preserved; set-like arrays are sorted by `normalizePwps` first.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite numbers cannot be canonicalized");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported value type: ${typeof value}`);
}

const byKey =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };

function clean<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Semantic normalization prior to hashing:
 *  - only known core properties are kept (unknown properties never affect identity),
 *  - defaults are made explicit (required/terminal=false, severity=MANDATORY, ...),
 *  - durations are rewritten in canonical form (PT300S → PT5M),
 *  - set-like arrays are sorted; `states` and `constraints` keep declaration order.
 */
export function normalizePwps(doc: PwpsDocument): PwpsDocument {
  const zones = doc.zones?.map((z): PwpsZone => clean({ id: z.id, name: z.name, description: z.description }));
  const states = doc.states.map(
    (s): PwpsState =>
      clean({
        id: s.id,
        name: s.name,
        required: s.required ?? false,
        terminal: s.terminal ?? false,
        zone: s.zone,
        description: s.description,
        metadata: s.metadata,
      }),
  );
  const transitions = doc.transitions
    ?.map((t): PwpsTransition => clean({ id: t.id, from: t.from, to: t.to }))
    .sort(byKey((t) => `${t.from}\u0000${t.to}\u0000${t.id ?? ""}`));
  const constraints = doc.constraints.map(normalizeConstraint);
  const evidence = doc.evidence
    ?.map(
      (e): EvidenceRequirement =>
        clean({
          state: e.state,
          required: e.required ?? true,
          zone: e.zone,
          accepted_authority: e.accepted_authority ? [...e.accepted_authority].sort() : undefined,
        }),
    )
    .sort(byKey((e) => e.state));
  const uncertainty: UncertaintyPolicy = {
    ambiguous_ordering: doc.uncertainty?.ambiguous_ordering ?? "NOT_EVALUABLE",
    required_state_unresolved: doc.uncertainty?.required_state_unresolved ?? "NOT_EVALUABLE",
    source_coverage_gap: doc.uncertainty?.source_coverage_gap ?? "NOT_EVALUABLE",
  };
  const failure_conditions = doc.failure_conditions
    ?.map((f): FailureCondition => clean({ id: f.id, description: f.description, constraint_ref: f.constraint_ref }))
    .sort(byKey((f) => f.id));

  return clean({
    pwps: doc.pwps,
    protocol: clean({
      id: doc.protocol.id,
      version: doc.protocol.version,
      name: doc.protocol.name,
      description: doc.protocol.description,
    }),
    metadata: doc.metadata,
    zones: zones?.sort(byKey((z) => z.id)),
    states,
    transitions,
    constraints,
    evidence,
    uncertainty,
    failure_conditions,
    extensions: doc.extensions,
  });
}

function normalizeConstraint(c: PwpsConstraint): PwpsConstraint {
  const common = { id: c.id, description: c.description, severity: c.severity ?? "MANDATORY" } as const;
  switch (c.operator) {
    case "REQUIRED":
      return clean({ ...common, operator: "REQUIRED", state: c.state });
    case "BEFORE":
      return clean({ ...common, operator: "BEFORE", state: c.state, reference: c.reference });
    case "AFTER":
      return clean({ ...common, operator: "AFTER", state: c.state, reference: c.reference });
    case "WITHIN": {
      const ms = parseDuration(c.duration);
      return clean({
        ...common,
        operator: "WITHIN",
        state: c.state,
        after: c.after,
        duration: ms === null ? c.duration : formatDuration(ms),
      });
    }
    case "FORBIDDEN":
      return clean({
        ...common,
        operator: "FORBIDDEN",
        transition: c.transition ? { from: c.transition.from, to: c.transition.to } : undefined,
        state: c.state,
      });
  }
}

/** Canonical JSON text of a (valid) PWPS document. */
export function canonicalizePwps(doc: PwpsDocument): string {
  return canonicalJson(normalizePwps(doc));
}
