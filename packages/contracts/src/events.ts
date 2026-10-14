import { z } from "zod";
import type { Action } from "./enums";

/**
 * Domain event vocabulary (Doc 06 §17–19). `type` is the stable machine name used as
 * EventBridge `detail-type`; namespaces group events by authority zone.
 */
export const EVENT_TYPES = {
  RingSourceEventReceived: "seqseal.ring.source_event_received",
  SourceHealthChanged: "seqseal.ring.source_health_changed",
  ObservationNormalized: "seqseal.observation.normalized",
  EvidenceInterpretationRequested: "seqseal.evidence.interpretation_requested",
  EvidenceCandidateCreated: "seqseal.evidence.candidate_created",
  EvidenceAccepted: "seqseal.evidence.accepted",
  EvidenceUnresolved: "seqseal.evidence.unresolved",
  EvidenceReviewed: "seqseal.evidence.reviewed",
  ExecutionOpened: "seqseal.execution.opened",
  ExecutionFinalizationRequested: "seqseal.execution.finalization_requested",
  CorrelationAmbiguityDetected: "seqseal.execution.correlation_ambiguity",
  WorkflowEvaluated: "seqseal.verification.completed",
  OperationalDecisionCreated: "seqseal.operation.decision_created",
  WorkflowReleased: "seqseal.operation.workflow_released",
  WorkflowHeld: "seqseal.operation.workflow_held",
  WorkflowReviewRequired: "seqseal.operation.workflow_review_required",
  WorkflowAwaitingEvidence: "seqseal.operation.workflow_awaiting_evidence",
  ActionApplied: "seqseal.operation.action_applied",
  ReceiptGenerated: "seqseal.receipt.generated",
  SystemError: "seqseal.system.error",
} as const;

export type EventName = keyof typeof EVENT_TYPES;
export type EventType = (typeof EVENT_TYPES)[EventName];

/** Business-meaningful operational events (Doc 05 §111: never a generic StatusChanged). */
export const ACTION_EVENT: Record<Action, EventName> = {
  RELEASE: "WorkflowReleased",
  HOLD: "WorkflowHeld",
  REVIEW: "WorkflowReviewRequired",
  WAIT: "WorkflowAwaitingEvidence",
};

export const DomainEvent = z.object({
  event_id: z.string().min(1),
  event_type: z.string(),
  /** Short PascalCase name, e.g. "WorkflowHeld". */
  name: z.string(),
  event_version: z.string(),
  occurred_at: z.string().datetime({ offset: true }),
  correlation_id: z.string().min(1),
  execution_id: z.string().optional(),
  payload: z.record(z.unknown()),
});
export type DomainEvent = z.infer<typeof DomainEvent>;

export const EVENT_SOURCE = "seqseal";
export const EVENT_VERSION = "1.0";
