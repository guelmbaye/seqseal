import { describeRule, type CompiledProtocol } from "@pwps/core";
import {
  ENGINE_VERSION,
  POLICY_ENGINE_VERSION,
  RESOLVER_VERSION,
  type DomainEvent,
  type ExplanationLink,
  type Evidence,
  type EvidenceCandidate,
  type EvidenceReview,
  type Execution,
  type NormalizedObservation,
  type OperationalDecision,
  type ReceivingWorkflow,
  type SeqSealReceipt,
  type WorkflowEvaluation,
} from "@seqseal/contracts";
import { buildExplanationChain, signatureRule } from "./explanation-chain";
import type { PipelineConfig } from "./pipeline";
import type { SeqSealStore } from "./store/repository";

export interface ProtocolView {
  id: string;
  version: string;
  ref: string;
  name: string;
  description?: string;
  hash: string;
  pwps: string;
  expected_sequence: string[];
  labels: Record<string, string>;
  states: Array<{ id: string; label: string; required: boolean; terminal: boolean; zone?: string }>;
  zones: Array<{ id: string; name?: string }>;
  rules: Array<{ id: string; kind: string; operator: string; severity: string; text: string; implicit?: boolean }>;
  /** The protocol's signature rule (first failure condition), e.g. ORDER-02 for IDP-01. */
  signature_rule?: string;
}

export interface PolicyView {
  id: string;
  name: string;
  version: string;
  ref: string;
  hash: string;
  profile: string;
  mappings: Record<string, string>;
  provisional_actions: string[];
}

export interface ExecutionSummary {
  execution_id: string;
  number: number;
  status: Execution["status"];
  opened_at: string;
  updated_at: string;
  verdict?: string;
  integrity?: string;
  action?: string;
  workflow_status: string;
  primary_rule?: string;
  explanation?: string;
  observed: string[];
  source_profiles: string[];
  replay?: Execution["replay"];
  receipt_id?: string;
  system_error?: Execution["system_error"];
}

export interface ExecutionDetail {
  execution: Execution;
  summary: ExecutionSummary;
  evaluation?: WorkflowEvaluation;
  evaluations: Array<Pick<WorkflowEvaluation, "evaluation_id" | "seq" | "mode" | "verdict" | "integrity_state" | "evaluated_at" | "trigger" | "primary_failures">>;
  decisions: OperationalDecision[];
  workflow?: ReceivingWorkflow;
  receipts: SeqSealReceipt[];
  evidence: Evidence[];
  candidates: EvidenceCandidate[];
  observations: NormalizedObservation[];
  reviews: EvidenceReview[];
  events: DomainEvent[];
  /** Why the workflow is in its current state; present once a decision exists for the latest evaluation. */
  explanation_chain?: ExplanationLink[];
}

export interface HeroView {
  /** "pair": latest released + latest held delivery. "latest": a delivery is in progress, show the two most recent. */
  mode: "pair" | "latest" | "empty";
  a?: ExecutionDetail;
  b?: ExecutionDetail;
  same_protocol: boolean;
  same_policy: boolean;
  same_mappings: boolean;
}

export interface SystemStatus {
  backend: string;
  protocol: { ref: string; hash: string; name: string };
  policy: { ref: string; hash: string; mappings: Record<string, string> };
  sources: { lane: string; hash: string; bindings: number; mappings: number; profiles: string[] };
  engine_version: string;
  policy_engine_version: string;
  resolver_version: string;
  interpreter: string;
  counts: { executions: number; receipts: number; observations: number };
  last_observation?: { observation_id: string; source_profile: string; event_type: string; occurred_at: string; received_at: string };
  profiles_seen: string[];
  flags: Record<string, boolean>;
}

export function protocolView(p: CompiledProtocol): ProtocolView {
  return {
    id: p.id,
    version: p.version,
    ref: p.ref,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    hash: p.hash,
    pwps: p.pwps,
    expected_sequence: p.expectedSequence,
    labels: Object.fromEntries(p.states.map((s) => [s.id, s.label.toUpperCase()])),
    states: p.states.map((s) => ({ id: s.id, label: s.label, required: s.required, terminal: s.terminal, ...(s.zone ? { zone: s.zone } : {}) })),
    zones: p.zones,
    rules: p.rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      operator: r.operator,
      severity: r.severity,
      text: describeRule(p, r),
      ...(r.kind === "REQUIRED" && r.implicit ? { implicit: true } : {}),
    })),
    ...(signatureRule(p) ? { signature_rule: signatureRule(p)! } : {}),
  };
}

export function policyView(config: PipelineConfig): PolicyView {
  const p = config.policy;
  return { id: p.id, name: p.name, version: p.version, ref: p.ref, hash: p.hash, profile: p.profile, mappings: p.mappings, provisional_actions: p.provisionalActions };
}

/** Query side used by the read API Lambda and the local web backend. */
export class ReadModel {
  constructor(
    private readonly store: SeqSealStore,
    private readonly config: PipelineConfig,
    private readonly meta: { backend: string; interpreter: string; flags?: Record<string, boolean> },
  ) {}

  protocol() {
    return protocolView(this.config.protocol);
  }
  policy() {
    return policyView(this.config);
  }

  private async summarize(e: Execution): Promise<ExecutionSummary> {
    const evaluation = e.latest_evaluation_id ? await this.store.getEvaluation(e.latest_evaluation_id) : undefined;
    return {
      execution_id: e.execution_id,
      number: e.number,
      status: e.status,
      opened_at: e.opened_at,
      updated_at: e.updated_at,
      ...(e.latest_verdict ? { verdict: e.latest_verdict } : {}),
      ...(e.latest_integrity ? { integrity: e.latest_integrity } : {}),
      ...(e.latest_action ? { action: e.latest_action } : {}),
      workflow_status: e.workflow_status,
      ...(evaluation?.primary_failures[0] ? { primary_rule: evaluation.primary_failures[0] } : {}),
      ...(evaluation ? { explanation: evaluation.explanation, observed: evaluation.observed_sequence.map((s) => s.state) } : { observed: [] }),
      source_profiles: e.source_profiles,
      ...(e.replay ? { replay: e.replay } : {}),
      ...(e.receipt_ids.length ? { receipt_id: e.receipt_ids[e.receipt_ids.length - 1] } : {}),
      ...(e.system_error ? { system_error: e.system_error } : {}),
    } as ExecutionSummary;
  }

  async listExecutions(limit = 50): Promise<ExecutionSummary[]> {
    return Promise.all((await this.store.listExecutions(limit)).map((e) => this.summarize(e)));
  }

  async executionDetail(id: string): Promise<ExecutionDetail | undefined> {
    const execution = await this.store.getExecution(id);
    if (!execution) return undefined;
    const [evaluations, decisions, wf, receipts, evidence, candidates, reviews, events] = await Promise.all([
      this.store.listEvaluations(id),
      this.store.listDecisions(id),
      this.store.getWorkflow(id),
      this.store.listExecutionReceipts(id),
      this.store.listExecutionEvidence(id),
      this.store.listExecutionCandidates(id),
      this.store.listReviews(id),
      this.store.listExecutionEvents(id),
    ]);
    const obsIds = [...new Set([...evidence.flatMap((e) => e.observation_refs), ...candidates.flatMap((c) => c.observation_refs)])];
    const observations = (await Promise.all(obsIds.map((o) => this.store.getObservation(o)))).filter((o): o is NormalizedObservation => !!o);
    const latest = evaluations.at(-1);
    const decision = latest ? decisions.find((d) => d.evaluation_id === latest.evaluation_id) : undefined;
    const explanation_chain =
      latest && decision
        ? buildExplanationChain({ protocol: this.config.protocol, evaluation: latest, action: decision.action, policyRef: `${decision.action_policy_id}@${decision.action_policy_version}`, evidence, decisionId: decision.decision_id })
        : undefined;
    return {
      execution,
      summary: await this.summarize(execution),
      ...(latest ? { evaluation: latest } : {}),
      evaluations: evaluations.map((v) => ({
        evaluation_id: v.evaluation_id,
        seq: v.seq,
        mode: v.mode,
        verdict: v.verdict,
        integrity_state: v.integrity_state,
        evaluated_at: v.evaluated_at,
        trigger: v.trigger,
        primary_failures: v.primary_failures,
      })),
      decisions,
      ...(wf.wf ? { workflow: wf.wf } : {}),
      receipts,
      evidence: evidence.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
      candidates,
      observations: observations.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
      reviews,
      events: events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
      ...(explanation_chain ? { explanation_chain } : {}),
    };
  }

  async receipts(limit = 50) {
    return this.store.listReceipts(limit);
  }
  async receipt(id: string) {
    return this.store.getReceipt(id);
  }
  async events(limit = 100) {
    return this.store.listEvents(limit);
  }
  async observations(limit = 50) {
    return this.store.listRecentObservations(limit);
  }

  /**
   * Winning Moment pairing: the most recent finalized SEALED/RELEASED and DEVIATED/HELD
   * executions evaluated under the same protocol and the same policy.
   */
  /**
   * The checklist hero (Master Brief §38): Delivery A next to Delivery B.
   *
   *   pair    the latest released delivery next to the latest held one (the Winning Moment);
   *   latest  a delivery is in progress (e.g. a live Ring Playground session): it fills in live.
   *           If the previous delivery finished minutes ago from the same source, the two form a
   *           session (A = previous, B = in progress); otherwise the new one is A and B waits.
   *           Also used when no released/held pair exists yet.
   */
  async hero(): Promise<HeroView> {
    const all = await this.store.listExecutions(100);
    const newest = all[0];
    const sameProfiles = (x: Execution, y: Execution) => x.source_profiles.join() === y.source_profiles.join();
    const sealed = all.find((e) => e.status === "FINALIZED" && e.latest_verdict === "SEALED" && e.workflow_status === "RELEASED");
    // The pair must be comparable: same protocol and same kind of source (never a live delivery next to a fixture).
    const deviated = sealed ? all.find((e) => e.latest_verdict === "DEVIATED" && e.workflow_status === "HELD" && e.protocol_hash === sealed.protocol_hash && sameProfiles(e, sealed)) : undefined;

    let mode: HeroView["mode"] = "empty";
    let first: Execution | undefined;
    let second: Execution | undefined;
    if (newest && newest.status !== "ACTIVE" && sealed && deviated && (newest === sealed || newest === deviated || sameProfiles(newest, sealed))) {
      mode = "pair";
      [first, second] = [sealed, deviated];
    } else if (newest) {
      mode = "latest";
      const prev = all[1];
      const endedAt = prev ? Date.parse(prev.finalized_at ?? prev.updated_at) : NaN;
      const session = !!prev && prev.status === "FINALIZED" && sameProfiles(prev, newest) && Date.parse(newest.created_at) - endedAt < 15 * 60_000;
      [first, second] = session ? [prev, newest] : [newest, undefined];
    }
    const [a, b] = await Promise.all([first ? this.executionDetail(first.execution_id) : undefined, second ? this.executionDetail(second.execution_id) : undefined]);
    const both = !!first && !!second;
    return {
      mode,
      ...(a ? { a } : {}),
      ...(b ? { b } : {}),
      same_protocol: both && first!.protocol_hash === second!.protocol_hash,
      same_policy: both && first!.action_policy_ref === second!.action_policy_ref,
      same_mappings: both && !!first!.source_config_hash && first!.source_config_hash === second!.source_config_hash,
    };
  }

  async status(): Promise<SystemStatus> {
    const [executions, receipts, observations] = await Promise.all([this.store.listExecutions(1000), this.store.listReceipts(1000), this.store.listRecentObservations(200)]);
    const last = observations[0];
    return {
      backend: this.meta.backend,
      protocol: { ref: this.config.protocol.ref, hash: this.config.protocol.hash, name: this.config.protocol.name },
      policy: { ref: this.config.policy.ref, hash: this.config.policy.hash, mappings: this.config.policy.mappings },
      sources: {
        lane: this.config.sources.lane,
        hash: this.config.sources.hash,
        bindings: this.config.sources.bindings.length,
        mappings: this.config.sources.mappings.length,
        profiles: [...new Set(this.config.sources.bindings.flatMap((b) => b.source_profiles))],
      },
      engine_version: ENGINE_VERSION,
      policy_engine_version: POLICY_ENGINE_VERSION,
      resolver_version: RESOLVER_VERSION,
      interpreter: this.meta.interpreter,
      counts: { executions: executions.length, receipts: receipts.length, observations: observations.length },
      ...(last
        ? { last_observation: { observation_id: last.observation_id, source_profile: last.source_profile, event_type: last.event_type, occurred_at: last.occurred_at, received_at: last.received_at } }
        : {}),
      profiles_seen: [...new Set(observations.map((o) => o.source_profile))],
      flags: this.meta.flags ?? {},
    };
  }
}
