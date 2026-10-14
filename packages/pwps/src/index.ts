/**
 * @pwps/core — reference implementation of PWPS 0.1
 * (Physical Workflow Protocol Specification).
 *
 * Describe the workflow once. Verify it against any trustworthy evidence source.
 */
export * from "./types";
export * from "./errors";
export { parseDuration, formatDuration, humanizeDuration } from "./duration";
export { parsePwpsSource, type ParseOptions, type ParseResult } from "./parser";
export { validateStructure } from "./structural";
export { validateSemantics, precedenceEdges, type OrderEdge } from "./semantic";
export { validatePwps, validatePwpsFile, type ValidateOptions, type ValidationResult } from "./validate";
export { canonicalJson, normalizePwps, canonicalizePwps } from "./canonicalize";
export { hashPwps, sha256Hex } from "./hash";
export {
  compilePwps,
  compilePwpsFile,
  compileDocument,
  type CompiledProtocol,
  type CompiledRule,
  type CompiledState,
  type CompiledEvidenceRequirement,
  type RequiredRule,
  type PrecedenceRule,
  type WithinRule,
  type ForbiddenStateRule,
  type ForbiddenTransitionRule,
} from "./compile";
export {
  evaluateRule,
  evaluateRules,
  observedSequence,
  type StateObservation,
  type Timeline,
  type RuleResult,
  type RuleStatus,
  type RuleReason,
} from "./evaluate";
export { describeRule, inspectProtocol } from "./inspect";

/** Convenience aliases matching SPEC §14 API names. */
export { parsePwpsSource as parsePwps } from "./parser";
export { canonicalizePwps as canonicalize } from "./canonicalize";
