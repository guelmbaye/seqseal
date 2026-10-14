import { PwpsValidationError } from "./errors";
import { parseDuration } from "./duration";
import { hashPwps } from "./hash";
import { precedenceEdges } from "./semantic";
import { validatePwps, validatePwpsFile, type ValidateOptions } from "./validate";
import type { EvidenceAuthority, PwpsDocument, Severity, UncertaintyPolicy } from "./types";

export interface CompiledState {
  id: string;
  label: string;
  index: number;
  required: boolean;
  terminal: boolean;
  zone?: string;
}

interface RuleBase {
  id: string;
  severity: Severity;
  description?: string;
  /** Declaration index in the source document (stable ordering). */
  order: number;
}

export interface RequiredRule extends RuleBase {
  kind: "REQUIRED";
  operator: "REQUIRED";
  state: string;
  /** True when synthesized from `states[].required: true` without an explicit REQUIRED constraint. */
  implicit: boolean;
}

/** Normalized strict precedence: t(first) < t(second). */
export interface PrecedenceRule extends RuleBase {
  kind: "PRECEDENCE";
  operator: "BEFORE" | "AFTER";
  first: string;
  second: string;
}

/** 0 < t(target) − t(anchor) ≤ maxMs (inclusive maximum). */
export interface WithinRule extends RuleBase {
  kind: "WITHIN";
  operator: "WITHIN";
  anchor: string;
  target: string;
  maxMs: number;
  duration: string;
}

export interface ForbiddenTransitionRule extends RuleBase {
  kind: "FORBIDDEN_TRANSITION";
  operator: "FORBIDDEN";
  from: string;
  to: string;
}

export interface ForbiddenStateRule extends RuleBase {
  kind: "FORBIDDEN_STATE";
  operator: "FORBIDDEN";
  state: string;
}

export type CompiledRule = RequiredRule | PrecedenceRule | WithinRule | ForbiddenTransitionRule | ForbiddenStateRule;

export interface CompiledEvidenceRequirement {
  state: string;
  required: boolean;
  zone?: string;
  acceptedAuthority?: EvidenceAuthority[];
}

/**
 * Deterministic graph representation of a PWPS protocol. The PWPS document
 * remains the normative source; this structure is implementation convenience.
 */
export interface CompiledProtocol {
  pwps: string;
  id: string;
  version: string;
  name: string;
  description?: string;
  /** `id@version` */
  ref: string;
  /** `sha256:…` of the canonical document. */
  hash: string;
  states: CompiledState[];
  stateIndex: Record<string, CompiledState>;
  requiredStates: string[];
  terminalStates: string[];
  /** First state of the expected sequence: opens an execution. */
  openingState: string;
  /** Topological order consistent with all precedence rules (ties by declaration order). */
  expectedSequence: string[];
  rules: CompiledRule[];
  zones: Array<{ id: string; name?: string }>;
  evidenceRequirements: Record<string, CompiledEvidenceRequirement>;
  uncertainty: Required<UncertaintyPolicy>;
  /** Normalized source document. */
  document: PwpsDocument;
}

/** Compile an already-validated, normalized document. */
export function compileDocument(doc: PwpsDocument): CompiledProtocol {
  const states: CompiledState[] = doc.states.map((s, index) => ({
    id: s.id,
    label: s.name ?? s.id,
    index,
    required: s.required === true,
    terminal: s.terminal === true,
    ...(s.zone ? { zone: s.zone } : {}),
  }));
  const stateIndex = Object.fromEntries(states.map((s) => [s.id, s]));

  const rules: CompiledRule[] = [];
  const explicitRequired = new Set<string>();
  doc.constraints.forEach((c, order) => {
    const base = { id: c.id, severity: c.severity ?? "MANDATORY", order, ...(c.description ? { description: c.description } : {}) };
    switch (c.operator) {
      case "REQUIRED":
        explicitRequired.add(c.state);
        rules.push({ ...base, kind: "REQUIRED", operator: "REQUIRED", state: c.state, implicit: false });
        break;
      case "BEFORE":
        rules.push({ ...base, kind: "PRECEDENCE", operator: "BEFORE", first: c.state, second: c.reference });
        break;
      case "AFTER":
        rules.push({ ...base, kind: "PRECEDENCE", operator: "AFTER", first: c.reference, second: c.state });
        break;
      case "WITHIN":
        rules.push({
          ...base,
          kind: "WITHIN",
          operator: "WITHIN",
          anchor: c.after,
          target: c.state,
          maxMs: parseDuration(c.duration) ?? 0,
          duration: c.duration,
        });
        break;
      case "FORBIDDEN":
        if (c.transition) {
          rules.push({ ...base, kind: "FORBIDDEN_TRANSITION", operator: "FORBIDDEN", from: c.transition.from, to: c.transition.to });
        } else if (c.state) {
          rules.push({ ...base, kind: "FORBIDDEN_STATE", operator: "FORBIDDEN", state: c.state });
        }
        break;
    }
  });

  // States flagged `required: true` without an explicit REQUIRED constraint get an implicit rule.
  let implicitOrder = doc.constraints.length;
  for (const s of states) {
    if (s.required && !explicitRequired.has(s.id)) {
      rules.push({ id: `REQ:${s.id}`, kind: "REQUIRED", operator: "REQUIRED", state: s.id, implicit: true, severity: "MANDATORY", order: implicitOrder++ });
    }
  }

  const requiredSet = new Set<string>([...states.filter((s) => s.required).map((s) => s.id), ...explicitRequired]);
  for (const s of states) if (requiredSet.has(s.id)) s.required = true;

  const expectedSequence = topologicalOrder(states, precedenceEdges(doc.constraints));
  const evidenceRequirements: Record<string, CompiledEvidenceRequirement> = {};
  for (const e of doc.evidence ?? []) {
    evidenceRequirements[e.state] = {
      state: e.state,
      required: e.required ?? true,
      ...(e.zone ? { zone: e.zone } : stateIndex[e.state]?.zone ? { zone: stateIndex[e.state]!.zone } : {}),
      ...(e.accepted_authority ? { acceptedAuthority: [...e.accepted_authority] } : {}),
    };
  }

  return {
    pwps: doc.pwps,
    id: doc.protocol.id,
    version: doc.protocol.version,
    name: doc.protocol.name,
    ...(doc.protocol.description ? { description: doc.protocol.description } : {}),
    ref: `${doc.protocol.id}@${doc.protocol.version}`,
    hash: hashPwps(doc),
    states,
    stateIndex,
    requiredStates: states.filter((s) => s.required).map((s) => s.id),
    terminalStates: states.filter((s) => s.terminal).map((s) => s.id),
    openingState: expectedSequence[0]!,
    expectedSequence,
    rules,
    zones: (doc.zones ?? []).map((z) => ({ id: z.id, ...(z.name ? { name: z.name } : {}) })),
    evidenceRequirements,
    uncertainty: {
      ambiguous_ordering: "NOT_EVALUABLE",
      required_state_unresolved: "NOT_EVALUABLE",
      source_coverage_gap: "NOT_EVALUABLE",
    },
    document: doc,
  };
}

function topologicalOrder(states: CompiledState[], edges: Array<{ from: string; to: string }>): string[] {
  const indeg = new Map(states.map((s) => [s.id, 0]));
  const out = new Map<string, string[]>(states.map((s) => [s.id, []]));
  for (const e of edges) {
    if (!indeg.has(e.from) || !indeg.has(e.to)) continue;
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const index = new Map(states.map((s) => [s.id, s.index]));
  const ready = states.filter((s) => indeg.get(s.id) === 0).map((s) => s.id);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const n = ready.shift()!;
    order.push(n);
    for (const m of out.get(n)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) ready.push(m);
    }
  }
  return order;
}

/** Validate and compile a PWPS document (object or source text). Throws on invalid input. */
export function compilePwps(input: unknown, options: ValidateOptions = {}): CompiledProtocol {
  const result = validatePwps(input, options);
  if (!result.valid || !result.document) throw new PwpsValidationError(result.errors);
  return compileDocument(result.document);
}

export function compilePwpsFile(path: string, options: ValidateOptions = {}): CompiledProtocol {
  const result = validatePwpsFile(path, options);
  if (!result.valid || !result.document) throw new PwpsValidationError(result.errors);
  return compileDocument(result.document);
}
