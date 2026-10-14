/**
 * PWPS 0.1 — normative data model (Linear Verification Profile).
 *
 * PWPS describes WHAT SHOULD HAPPEN physically. It deliberately contains no
 * vendor identifiers, no infrastructure, no AI prompts and no business actions.
 */

export const PWPS_SPEC_VERSION = "0.1" as const;
export const SUPPORTED_PWPS_VERSIONS: readonly string[] = ["0.1"];

export const OPERATORS = ["REQUIRED", "BEFORE", "AFTER", "WITHIN", "FORBIDDEN"] as const;
export type Operator = (typeof OPERATORS)[number];

export const EVIDENCE_AUTHORITIES = ["DIRECT", "CONFIGURED", "AI_ASSISTED", "HUMAN_CONFIRMED"] as const;
export type EvidenceAuthority = (typeof EVIDENCE_AUTHORITIES)[number];

export const SEVERITIES = ["MANDATORY", "ADVISORY"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type UncertaintyOutcome = "NOT_EVALUABLE";

export interface ProtocolIdentity {
  id: string;
  version: string;
  name: string;
  description?: string;
}

export interface PwpsZone {
  id: string;
  name?: string;
  description?: string;
}

export interface PwpsState {
  id: string;
  name?: string;
  required?: boolean;
  terminal?: boolean;
  zone?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PwpsTransition {
  id?: string;
  from: string;
  to: string;
}

interface BaseConstraint {
  id: string;
  description?: string;
  severity?: Severity;
}

export interface RequiredConstraint extends BaseConstraint {
  operator: "REQUIRED";
  state: string;
}

/** `state` MUST occur strictly before `reference`: t(state) < t(reference). */
export interface BeforeConstraint extends BaseConstraint {
  operator: "BEFORE";
  state: string;
  reference: string;
}

/** `state` MUST occur strictly after `reference`: t(state) > t(reference). */
export interface AfterConstraint extends BaseConstraint {
  operator: "AFTER";
  state: string;
  reference: string;
}

/** `state` MUST occur within `duration` after `after`: 0 < t(state) − t(after) ≤ duration. */
export interface WithinConstraint extends BaseConstraint {
  operator: "WITHIN";
  state: string;
  after: string;
  duration: string;
}

/** Either a forbidden direct transition or a forbidden state. */
export interface ForbiddenConstraint extends BaseConstraint {
  operator: "FORBIDDEN";
  transition?: { from: string; to: string };
  state?: string;
}

export type PwpsConstraint =
  | RequiredConstraint
  | BeforeConstraint
  | AfterConstraint
  | WithinConstraint
  | ForbiddenConstraint;

export interface EvidenceRequirement {
  state: string;
  required?: boolean;
  zone?: string;
  accepted_authority?: EvidenceAuthority[];
}

export interface UncertaintyPolicy {
  ambiguous_ordering?: UncertaintyOutcome;
  required_state_unresolved?: UncertaintyOutcome;
  source_coverage_gap?: UncertaintyOutcome;
}

export interface FailureCondition {
  id: string;
  description?: string;
  constraint_ref: string;
}

export interface PwpsDocument {
  pwps: string;
  protocol: ProtocolIdentity;
  metadata?: Record<string, unknown>;
  zones?: PwpsZone[];
  states: PwpsState[];
  transitions?: PwpsTransition[];
  constraints: PwpsConstraint[];
  evidence?: EvidenceRequirement[];
  uncertainty?: UncertaintyPolicy;
  failure_conditions?: FailureCondition[];
  extensions?: Record<string, unknown>;
}

export type ValidationMode = "strict" | "compatible";
