import { z } from "zod";
import {
  Action,
  Assessment,
  CandidateStatus,
  CoverageStatus,
  EvaluationMode,
  ExecutionStatus,
  IntegrityState,
  InterpretationMode,
  ObservationFamily,
  Quality,
  ReceiptStage,
  ReviewAction,
  SourceHealth,
  SourceProfile,
  SystemErrorCode,
  Verdict,
  WorkflowStatus,
} from "./enums";

export const SCHEMA_VERSION = "1.0" as const;
const IsoTime = z.string().datetime({ offset: true });
const Id = z.string().min(1).max(200);

/* ───────────────────────────── Source layer ───────────────────────────── */

/** Reference back to the originating source (Ring event, Playground session, fixture). */
export const SourceRef = z.object({
  provider: z.literal("ring").or(z.literal("fixture")).or(z.literal("custom")),
  source_profile: SourceProfile,
  source_event_ref: z.string().optional(),
  request_ref: z.string().optional(),
  device_ref: z.string().optional(),
  component_refs: z.array(z.string()).optional(),
  media_session_ref: z.string().optional(),
  simulation_source: z.string().optional(),
  account_ref: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

/** Raw source record, persisted before interpretation (Doc 04 §35). */
export const RawSourceRecord = z.object({
  source_record_id: Id,
  provider: z.enum(["ring", "fixture", "custom"]),
  source_profile: SourceProfile,
  idempotency_key: Id,
  request_ref: z.string().optional(),
  source_event_ref: z.string().optional(),
  received_at: IsoTime,
  signature_verified: z.boolean(),
  correlation_id: Id,
  payload: z.unknown(),
  replay: z.object({ run_id: z.string(), scenario_id: z.string(), label: z.string().optional() }).optional(),
});
export type RawSourceRecord = z.infer<typeof RawSourceRecord>;

/** Vendor-neutral observation (Doc 04 §33). Still NOT workflow evidence. */
export const NormalizedObservation = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  observation_id: Id,
  correlation_id: Id,
  family: ObservationFamily,
  source_provider: z.enum(["ring", "fixture", "custom"]),
  source_profile: SourceProfile,
  source_account_ref: z.string().optional(),
  source_device_ref: z.string().optional(),
  source_component_refs: z.array(z.string()).default([]),
  source_event_ref: z.string().optional(),
  request_ref: z.string().optional(),
  event_type: z.string(),
  event_subtype: z.string().optional(),
  simulation_source: z.string().optional(),
  media_session_ref: z.string().optional(),
  occurred_at: IsoTime,
  received_at: IsoTime,
  /** Timestamp precision in ms (0 = exact as reported). */
  time_precision_ms: z.number().int().nonnegative().default(0),
  logical_zone: z.string().optional(),
  binding_id: z.string().optional(),
  source_health: SourceHealth.default("HEALTHY"),
  media_available: z.boolean().optional(),
  raw_source_ref: Id,
  /** Opaque, preserved verbatim; never interpreted by the protocol engine. */
  attributes: z.record(z.unknown()).default({}),
  replay: z.object({ run_id: z.string(), scenario_id: z.string(), label: z.string().optional() }).optional(),
});
export type NormalizedObservation = z.infer<typeof NormalizedObservation>;

/** Binding from source context to a SEQSEAL logical workflow zone (Doc 04 §18). */
export const SourceBinding = z.object({
  binding_id: Id,
  description: z.string().optional(),
  source_profiles: z.array(SourceProfile).min(1),
  source_device_ref: z.string().optional(),
  component_ref: z.string().optional(),
  simulation_source: z.string().optional(),
  /** Playground: zone declared by the operator for a capture session (matched on attributes.session_zone). */
  session_zone: z.string().optional(),
  logical_zone: z.string(),
  active: z.boolean().default(true),
});
export type SourceBinding = z.infer<typeof SourceBinding>;

/** Deterministic mapping rule: observation (+ zone) → candidate workflow state. */
export const EvidenceMappingRule = z.object({
  mapping_id: Id,
  description: z.string().optional(),
  when: z.object({
    event_type: z.array(z.string()).min(1),
    event_subtype: z.array(z.string()).optional(),
    logical_zone: z.string(),
    simulation_source: z.array(z.string()).optional(),
  }),
  state: z.string(),
  interpretation_mode: z.enum(["DIRECT", "CONFIGURED_MAPPING", "AI_ASSISTED"]),
});
export type EvidenceMappingRule = z.infer<typeof EvidenceMappingRule>;

export const SourceHealthWindow = z.object({
  source_key: z.string(),
  logical_zone: z.string().optional(),
  status: SourceHealth,
  from: IsoTime,
  to: IsoTime.optional(),
  reason: z.string().optional(),
  observation_ref: z.string().optional(),
});
export type SourceHealthWindow = z.infer<typeof SourceHealthWindow>;

/* ───────────────────────────── Evidence layer ───────────────────────────── */

export const EvidenceCandidate = z.object({
  candidate_id: Id,
  execution_id: z.string().optional(),
  semantic_state: z.string(),
  occurred_at: IsoTime,
  time_precision_ms: z.number().int().nonnegative().default(0),
  logical_zone: z.string(),
  interpretation_mode: InterpretationMode,
  status: CandidateStatus,
  status_reason: z.string().optional(),
  quality: Quality.optional(),
  confidence: z.number().min(0).max(1).optional(),
  assessment: Assessment.optional(),
  reason_code: z.string().optional(),
  model_id: z.string().optional(),
  interpreter_schema_version: z.string().optional(),
  media_ref: z.string().optional(),
  mapping_id: z.string().optional(),
  observation_refs: z.array(Id).min(1),
  source_refs: z.array(SourceRef).min(1),
  resolver_version: z.string(),
  created_at: IsoTime,
  updated_at: IsoTime.optional(),
  review_ids: z.array(Id).optional(),
});
export type EvidenceCandidate = z.infer<typeof EvidenceCandidate>;

/** Accepted, authoritative workflow evidence. Every item carries provenance (Doc 07 §18). */
export const Evidence = z.object({
  evidence_id: Id,
  candidate_id: Id,
  execution_id: z.string(),
  semantic_state: z.string(),
  occurred_at: IsoTime,
  time_precision_ms: z.number().int().nonnegative().default(0),
  logical_zone: z.string(),
  interpretation_mode: InterpretationMode,
  quality: Quality.optional(),
  model_id: z.string().optional(),
  observation_refs: z.array(Id).min(1),
  source_refs: z.array(SourceRef).min(1),
  resolver_version: z.string(),
  acceptance_rule: z.string(),
  review_id: z.string().optional(),
  accepted_at: IsoTime,
});
export type Evidence = z.infer<typeof Evidence>;

export const UncertaintyItem = z.object({
  kind: z.enum(["UNRESOLVED_CANDIDATE", "COVERAGE_GAP", "CORRELATION_AMBIGUITY", "AMBIGUOUS_ORDER", "PROVENANCE_INCOMPLETE", "AUTHORITY_NOT_ACCEPTED"]),
  state: z.string().optional(),
  rule_ids: z.array(z.string()).default([]),
  refs: z.array(z.string()).default([]),
  material: z.boolean(),
  detail: z.string(),
});
export type UncertaintyItem = z.infer<typeof UncertaintyItem>;

/* ───────────────────────────── Verification layer ───────────────────────────── */

export const RuleEvaluation = z.object({
  rule_id: z.string(),
  operator: z.string(),
  kind: z.string(),
  severity: z.enum(["MANDATORY", "ADVISORY"]),
  status: z.enum(["PASS", "FAIL", "NOT_EVALUABLE", "NOT_APPLICABLE"]),
  reason: z.string().optional(),
  states: z.array(z.string()),
  expected: z.record(z.union([z.string(), z.number()])),
  observed: z.record(z.union([z.string(), z.null()])),
  delta_ms: z.number().optional(),
  limit_ms: z.number().optional(),
  evidence_refs: z.array(z.string()),
  explanation_code: z.string(),
  explanation: z.string(),
});
export type RuleEvaluation = z.infer<typeof RuleEvaluation>;

export const ObservedStep = z.object({
  state: z.string(),
  occurred_at: IsoTime,
  evidence_id: z.string(),
  interpretation_mode: InterpretationMode,
});
export type ObservedStep = z.infer<typeof ObservedStep>;

export const Counterfactual = z.object({
  rule_id: z.string(),
  statement: z.string(),
  verdict_if_changed: Verdict,
});
export type Counterfactual = z.infer<typeof Counterfactual>;

/**
 * Evidence Graph — the observed model (Master Brief §7). Nodes are protocol states with the
 * accepted evidence that supports them; observed edges are temporal relations derived from
 * physical time and its precision; protocol edges overlay what PWPS expected on top of what
 * was observed. Built by the engine from the same timeline the rules are evaluated on.
 */
export const EvidenceGraphNode = z.object({
  state: z.string(),
  status: z.enum(["PRESENT", "ABSENT", "UNRESOLVED"]),
  occurred_at: IsoTime.optional(),
  precision_ms: z.number().int().nonnegative().optional(),
  evidence_refs: z.array(z.string()),
  reason: z.string().optional(),
});
export const EvidenceGraphEdge = z.object({
  from: z.string(),
  to: z.string(),
  relation: z.enum(["OBSERVED_BEFORE", "ORDER_UNDETERMINED"]),
  delta_ms: z.number().int(),
});
export const ProtocolGraphEdge = z.object({
  rule_id: z.string(),
  from: z.string(),
  to: z.string(),
  relation: z.enum(["MUST_PRECEDE", "WITHIN"]),
  status: z.string(),
  observed: z.enum(["OBSERVED_BEFORE", "OBSERVED_AFTER", "ORDER_UNDETERMINED", "NOT_OBSERVED"]),
});
export const EvidenceGraph = z.object({
  nodes: z.array(EvidenceGraphNode),
  edges: z.array(EvidenceGraphEdge),
  protocol_edges: z.array(ProtocolGraphEdge),
});
export type EvidenceGraph = z.infer<typeof EvidenceGraph>;

/** Pure output of the Sequence Integrity Engine (deterministic given its inputs). */
export const EngineResult = z.object({
  engine_version: z.string(),
  protocol_ref: z.string(),
  protocol_hash: z.string(),
  evidence_set_hash: z.string(),
  input_hash: z.string(),
  mode: EvaluationMode,
  expected_sequence: z.array(z.string()),
  observed_sequence: z.array(ObservedStep),
  rule_results: z.array(RuleEvaluation),
  missing_states: z.array(z.string()),
  unresolved_states: z.array(z.string()),
  uncertainty_items: z.array(UncertaintyItem),
  primary_failures: z.array(z.string()),
  secondary_failures: z.array(z.string()),
  potential_violations: z.array(z.string()),
  verdict: Verdict,
  integrity_state: IntegrityState,
  complete: z.boolean(),
  explanation: z.string(),
  counterfactual: Counterfactual.optional(),
  evidence_graph: EvidenceGraph.optional(),
});
export type EngineResult = z.infer<typeof EngineResult>;

export const WorkflowEvaluation = EngineResult.extend({
  evaluation_id: Id,
  execution_id: Id,
  seq: z.number().int().positive(),
  evaluated_at: IsoTime,
  trigger: z.string(),
  correlation_id: Id,
});
export type WorkflowEvaluation = z.infer<typeof WorkflowEvaluation>;

/* ───────────────────────────── Policy & action layer ───────────────────────────── */

export const ActionPolicyDocument = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  profile: z.literal("safe-mvp"),
  description: z.string().optional(),
  mappings: z.record(z.string()),
  provisional_actions: z.array(z.string()).default([]),
});
export type ActionPolicyDocument = z.infer<typeof ActionPolicyDocument>;

export const OperationalDecision = z.object({
  decision_id: Id,
  idempotency_key: z.string(),
  execution_id: Id,
  evaluation_id: Id,
  evaluation_seq: z.number().int().positive(),
  verdict: Verdict,
  action: Action,
  final: z.boolean(),
  action_policy_id: z.string(),
  action_policy_version: z.string(),
  action_policy_hash: z.string(),
  policy_engine_version: z.string(),
  reason_code: z.string(),
  reason: z.string(),
  reason_refs: z.array(z.string()),
  evidence_refs: z.array(z.string()),
  triggered_at: IsoTime,
  amends: z.string().optional(),
  correlation_id: Id,
});
export type OperationalDecision = z.infer<typeof OperationalDecision>;

export const WorkflowTransition = z.object({
  at: IsoTime,
  from: WorkflowStatus,
  to: WorkflowStatus,
  decision_id: z.string(),
  evaluation_id: z.string(),
  verdict: Verdict,
  action: Action,
  final: z.boolean(),
  event_type: z.string().optional(),
  reason: z.string(),
});
export type WorkflowTransition = z.infer<typeof WorkflowTransition>;

/** Minimal downstream business-state projection ("Receiving Workflow") — not a WMS. */
export const ReceivingWorkflow = z.object({
  execution_id: Id,
  status: WorkflowStatus,
  final: z.boolean(),
  last_decision_id: z.string().optional(),
  applied_decision_ids: z.array(z.string()),
  applied_evaluation_seq: z.number().int().nonnegative(),
  updated_at: IsoTime,
  history: z.array(WorkflowTransition),
});
export type ReceivingWorkflow = z.infer<typeof ReceivingWorkflow>;

/* ───────────────────────────── Execution & receipt ───────────────────────────── */

export const Execution = z.object({
  execution_id: Id,
  number: z.number().int().positive(),
  lane: z.string(),
  protocol_ref: z.string(),
  protocol_hash: z.string(),
  action_policy_ref: z.string(),
  /** Hash of the source bindings + evidence mappings in force when the execution opened. */
  source_config_hash: z.string().optional(),
  status: ExecutionStatus,
  opened_at: IsoTime,
  opened_by_evidence: z.string(),
  created_at: IsoTime,
  updated_at: IsoTime,
  finalized_at: IsoTime.optional(),
  evidence_ids: z.array(Id),
  candidate_ids: z.array(Id),
  uncertainty: z.array(UncertaintyItem).default([]),
  latest_evaluation_id: z.string().optional(),
  latest_evaluation_seq: z.number().int().nonnegative().default(0),
  latest_verdict: Verdict.optional(),
  latest_integrity: IntegrityState.optional(),
  latest_action: Action.optional(),
  workflow_status: WorkflowStatus.default("PENDING"),
  receipt_ids: z.array(Id).default([]),
  source_profiles: z.array(SourceProfile).default([]),
  replay: z.object({ run_id: z.string(), scenario_id: z.string(), label: z.string().optional() }).optional(),
  system_error: z.object({ code: SystemErrorCode, message: z.string(), at: IsoTime }).optional(),
  correlation_id: Id,
});
export type Execution = z.infer<typeof Execution>;

export const ReceiptEvidence = z.object({
  evidence_id: z.string(),
  state: z.string(),
  occurred_at: IsoTime,
  interpretation_mode: InterpretationMode,
  observation_refs: z.array(z.string()),
  source_refs: z.array(SourceRef),
  model_id: z.string().optional(),
  review_id: z.string().optional(),
});
export type ReceiptEvidence = z.infer<typeof ReceiptEvidence>;

/**
 * One link of the receipt explanation chain (Master Brief §35), e.g. for Delivery B:
 *   HOLD ← because ActionPolicy DEVIATED → HOLD ← because ORDER-02 FAILED
 *        ← because STORAGE 14:03 occurred before STAGING 14:06 ← based on Ring-derived evidence.
 * Built deterministically from the evaluation, the decision and the evidence — never by an LLM.
 */
export const ExplanationLink = z.object({
  kind: z.enum(["ACTION", "POLICY", "VERDICT", "RULE", "OBSERVATION", "EVIDENCE"]),
  connector: z.enum(["", "because", "based on"]),
  text: z.string(),
  refs: z.array(z.string()),
});
export type ExplanationLink = z.infer<typeof ExplanationLink>;

export const SourceEvidenceRef = z.object({
  evidence_id: z.string(),
  state: z.string(),
  source_profile: SourceProfile,
  source_event_ref: z.string().optional(),
  observation_ref: z.string().optional(),
});
export type SourceEvidenceRef = z.infer<typeof SourceEvidenceRef>;

/** Field names follow the Master Brief §34 receipt contract. */
export const SeqSealReceipt = z.object({
  receipt_id: Id,
  receipt_version: z.number().int().positive(),
  supersedes: z.string().optional(),
  stage: ReceiptStage,
  execution_id: Id,
  protocol_id: z.string(),
  protocol_version: z.string(),
  protocol_name: z.string(),
  protocol_hash: z.string(),
  evidence_set_hash: z.string(),
  engine_version: z.string(),
  input_hash: z.string(),
  evaluation_id: z.string(),
  expected_sequence: z.array(z.string()),
  observed_sequence: z.array(ObservedStep),
  rule_results: z.array(
    z.object({ rule_id: z.string(), status: z.string(), reason: z.string().optional(), explanation: z.string(), evidence_refs: z.array(z.string()) }),
  ),
  primary_failures: z.array(z.string()),
  verdict: Verdict,
  explanation: z.string(),
  action_policy_id: z.string(),
  action_policy_version: z.string(),
  action_policy_hash: z.string(),
  policy_engine_version: z.string(),
  operational_decision_id: z.string(),
  operational_action: Action,
  operational: z.object({
    policy_mapping: z.string(),
    applied: z.boolean(),
    workflow_status: WorkflowStatus,
    applied_at: IsoTime.optional(),
    /** Business event that put the workflow in `workflow_status` (e.g. WorkflowHeld), possibly from an earlier provisional decision. */
    event_type: z.string().optional(),
    event_at: IsoTime.optional(),
    event_decision_id: z.string().optional(),
  }),
  explanation_chain: z.array(ExplanationLink),
  source_config_hash: z.string().optional(),
  source_evidence_refs: z.array(SourceEvidenceRef),
  evidence: z.array(ReceiptEvidence),
  source_profiles: z.array(SourceProfile),
  uncertainty_items: z.array(UncertaintyItem),
  generated_at: IsoTime,
  receipt_hash: z.string(),
  disclaimer: z.string(),
});
export type SeqSealReceipt = z.infer<typeof SeqSealReceipt>;

export const EvidenceReview = z.object({
  review_id: Id,
  execution_id: Id,
  candidate_id: Id,
  action: ReviewAction,
  reviewer_ref: z.string(),
  rationale: z.string().optional(),
  at: IsoTime,
  resulting_evidence_id: z.string().optional(),
});
export type EvidenceReview = z.infer<typeof EvidenceReview>;

/** Snapshot of everything the engine saw — persisted for replay (Doc 03 §59). */
export const EvaluationInputSnapshot = z.object({
  protocol_ref: z.string(),
  protocol_hash: z.string(),
  engine_version: z.string(),
  mode: EvaluationMode,
  evidence: z.array(Evidence),
  unresolved: z.array(EvidenceCandidate),
  coverage: z.record(CoverageStatus),
  ambiguities: z.array(UncertaintyItem),
});
export type EvaluationInputSnapshot = z.infer<typeof EvaluationInputSnapshot>;
