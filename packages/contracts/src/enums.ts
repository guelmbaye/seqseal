import { z } from "zod";

/** Authoritative workflow verdicts (Sequence Integrity Engine). */
export const VERDICTS = ["SEALED", "DEVIATED", "INCOMPLETE", "UNCERTAIN"] as const;
export const Verdict = z.enum(VERDICTS);
export type Verdict = z.infer<typeof Verdict>;

/** Operational actions (Action Policy Engine). */
export const ACTIONS = ["RELEASE", "HOLD", "WAIT", "REVIEW"] as const;
export const Action = z.enum(ACTIONS);
export type Action = z.infer<typeof Action>;

/** Downstream receiving-workflow projection states (Operational Gate). */
export const WORKFLOW_STATUSES = ["PENDING", "WAITING", "REVIEW_REQUIRED", "HELD", "RELEASED"] as const;
export const WorkflowStatus = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const ACTION_TO_STATUS: Record<Action, WorkflowStatus> = {
  RELEASE: "RELEASED",
  HOLD: "HELD",
  WAIT: "WAITING",
  REVIEW: "REVIEW_REQUIRED",
};

/**
 * Where an observation came from. Never blurred in the UI (Doc 04 §10, Master Brief §25).
 * RING_DERIVED_REPLAY: events that really came from Ring (captured webhooks or Playground
 * captures) replayed later through the normal pipeline. FIXTURE_REPLAY: hand-written,
 * Ring-shaped test fixtures. CUSTOM_MEDIA is never presented as Ring evidence.
 */
export const SOURCE_PROFILES = ["RING_PLAYGROUND", "RING_WEBHOOK", "RING_STAGING", "RING_DERIVED_REPLAY", "FIXTURE_REPLAY", "CUSTOM_MEDIA"] as const;
export const SourceProfile = z.enum(SOURCE_PROFILES);
export type SourceProfile = z.infer<typeof SourceProfile>;

export const SOURCE_PROFILE_LABEL: Record<SourceProfile, string> = {
  RING_PLAYGROUND: "Ring Developer Playground",
  RING_WEBHOOK: "Ring Webhook",
  RING_STAGING: "Ring Staging",
  RING_DERIVED_REPLAY: "Ring-Derived Replay",
  FIXTURE_REPLAY: "Test Fixture Replay",
  CUSTOM_MEDIA: "Custom Demo Media — Not Ring",
};

/** How a workflow state was derived from observations. */
export const INTERPRETATION_MODES = ["DIRECT", "CONFIGURED_MAPPING", "AI_ASSISTED", "HUMAN_CONFIRMED"] as const;
export const InterpretationMode = z.enum(INTERPRETATION_MODES);
export type InterpretationMode = z.infer<typeof InterpretationMode>;

/** PWPS evidence authority class corresponding to each interpretation mode. */
export const MODE_TO_PWPS_AUTHORITY = {
  DIRECT: "DIRECT",
  CONFIGURED_MAPPING: "CONFIGURED",
  AI_ASSISTED: "AI_ASSISTED",
  HUMAN_CONFIRMED: "HUMAN_CONFIRMED",
} as const;

export const SOURCE_HEALTH = ["HEALTHY", "OFFLINE", "ACCESS_REVOKED", "MEDIA_UNREADABLE", "UNKNOWN"] as const;
export const SourceHealth = z.enum(SOURCE_HEALTH);
export type SourceHealth = z.infer<typeof SourceHealth>;

export const COVERAGE_STATUS = ["HEALTHY", "PARTIAL", "UNAVAILABLE", "UNKNOWN"] as const;
export const CoverageStatus = z.enum(COVERAGE_STATUS);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

export const CANDIDATE_STATUSES = ["CANDIDATE", "ACCEPTED", "REJECTED", "UNCERTAIN", "MEDIA_PENDING"] as const;
export const CandidateStatus = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const QUALITY = ["HIGH", "MEDIUM", "LOW"] as const;
export const Quality = z.enum(QUALITY);
export type Quality = z.infer<typeof Quality>;

export const ASSESSMENTS = ["SUPPORTED", "NOT_SUPPORTED", "AMBIGUOUS"] as const;
export const Assessment = z.enum(ASSESSMENTS);
export type Assessment = z.infer<typeof Assessment>;

/** Provisional integrity states shown while an execution is active (Doc 02 §26). */
export const INTEGRITY_STATES = [
  "VALID_SO_FAR",
  "WAITING_FOR_EVIDENCE",
  "POTENTIAL_ORDER_VIOLATION",
  "DEVIATION_DETECTED",
  "EVIDENCE_UNRESOLVED",
  "VERIFIED",
] as const;
export const IntegrityState = z.enum(INTEGRITY_STATES);
export type IntegrityState = z.infer<typeof IntegrityState>;

export const EXECUTION_STATUSES = ["ACTIVE", "FINALIZED", "SYSTEM_ERROR"] as const;
export const ExecutionStatus = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const EVALUATION_MODES = ["PROVISIONAL", "FINAL"] as const;
export const EvaluationMode = z.enum(EVALUATION_MODES);
export type EvaluationMode = z.infer<typeof EvaluationMode>;

/** Observation families: physical observations may become evidence; health never does (Doc 04 §70). */
export const OBSERVATION_FAMILIES = ["WORKFLOW_PHYSICAL", "INTEGRATION_HEALTH", "UNKNOWN"] as const;
export const ObservationFamily = z.enum(OBSERVATION_FAMILIES);
export type ObservationFamily = z.infer<typeof ObservationFamily>;

/** Infrastructure failure taxonomy — never semantic verdicts (Doc 06 §111, Doc 07 §97). */
export const SYSTEM_ERROR_CODES = [
  "SOURCE_ERROR",
  "TRANSPORT_ERROR",
  "NORMALIZATION_ERROR",
  "EVIDENCE_ERROR",
  "AI_ERROR",
  "ENGINE_ERROR",
  "POLICY_ERROR",
  "GATE_ERROR",
  "RECEIPT_ERROR",
  "PROTOCOL_INVALID",
  "POLICY_INVALID",
] as const;
export const SystemErrorCode = z.enum(SYSTEM_ERROR_CODES);
export type SystemErrorCode = z.infer<typeof SystemErrorCode>;

export const REVIEW_ACTIONS = ["CONFIRM", "REJECT", "LEAVE_UNRESOLVED"] as const;
export const ReviewAction = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof ReviewAction>;

export const RECEIPT_STAGES = ["VERIFICATION_FINALIZED", "ACTION_PENDING", "ACTION_APPLIED", "RECEIPT_FINALIZED"] as const;
export const ReceiptStage = z.enum(RECEIPT_STAGES);
export type ReceiptStage = z.infer<typeof ReceiptStage>;
