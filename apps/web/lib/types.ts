// Type-only re-exports: nothing from the server pipeline is bundled into the browser.
export type {
  DomainEvent,
  Evidence,
  EvidenceCandidate,
  NormalizedObservation,
  OperationalDecision,
  ReceivingWorkflow,
  RuleEvaluation,
  SeqSealReceipt,
  WorkflowEvaluation,
  ObservedStep,
} from "@seqseal/contracts";
export type { ExecutionDetail, ExecutionSummary, ProtocolView, PolicyView, SystemStatus, ScenarioInfo, ReplayCheck } from "@seqseal/pipeline";

export type Verdict = "SEALED" | "DEVIATED" | "INCOMPLETE" | "UNCERTAIN";
export type Action = "RELEASE" | "HOLD" | "WAIT" | "REVIEW";
export type WorkflowStatus = "PENDING" | "WAITING" | "REVIEW_REQUIRED" | "HELD" | "RELEASED";

export const STATUS_ACTION: Record<WorkflowStatus, Action | null> = {
  PENDING: null,
  WAITING: "WAIT",
  REVIEW_REQUIRED: "REVIEW",
  HELD: "HOLD",
  RELEASED: "RELEASE",
};

export const ACTION_WORD: Record<Action, string> = { RELEASE: "RELEASED", HOLD: "HOLD", WAIT: "WAIT", REVIEW: "REVIEW" };

export const VERDICT_TONE: Record<Verdict, "seal" | "hold" | "wait" | "review"> = {
  SEALED: "seal",
  DEVIATED: "hold",
  INCOMPLETE: "wait",
  UNCERTAIN: "review",
};
export const ACTION_TONE: Record<Action, "seal" | "hold" | "wait" | "review"> = { RELEASE: "seal", HOLD: "hold", WAIT: "wait", REVIEW: "review" };

export const ACTION_MEANING: Record<Action, string> = {
  RELEASE: "Protocol requirements satisfied. Workflow may proceed.",
  HOLD: "A protocol violation was proven. Workflow is paused.",
  WAIT: "Required evidence is not complete yet.",
  REVIEW: "Evidence is ambiguous or coverage is insufficient. Human review is required.",
};

export const SOURCE_LABEL: Record<string, string> = {
  RING_PLAYGROUND: "Ring Developer Playground",
  RING_WEBHOOK: "Ring webhook",
  RING_STAGING: "Ring staging",
  FIXTURE_REPLAY: "Test fixture (Ring-shaped replay)",
  CUSTOM_MEDIA: "Custom demo media (not Ring)",
};
