import type { CompiledProtocol } from "@pwps/core";
import { decide as policyDecide, ReleaseInvariantViolation, type ActionPolicy } from "@seqseal/action-policy-core";
import {
  ACTION_EVENT,
  ACTION_TO_STATUS,
  ENGINE_VERSION,
  pad,
  sha256Hex,
  toIso,
  toMs,
  type DomainEvent,
  type EvaluationInputSnapshot,
  type EvaluationMode,
  type EventName,
  type Evidence,
  type EvidenceCandidate,
  type EvidenceReview,
  type Execution,
  type NormalizedObservation,
  type OperationalDecision,
  type RawSourceRecord,
  type ReceivingWorkflow,
  type ReviewAction,
  type SourceProfile,
  type SystemErrorCode,
  type UncertaintyItem,
  type WorkflowEvaluation,
} from "@seqseal/contracts";
import { evaluateExecution } from "@seqseal/engine-core";
import {
  applyAcceptance,
  bindObservation,
  candidateFromInterpretation,
  computeCoverage,
  evidenceIdFor,
  resolveObservation,
  type AcceptancePolicy,
  type EvidenceInterpreter,
  type SourceConfig,
} from "@seqseal/evidence-model";
import {
  deliveryIdempotencyKey,
  headerValue,
  normalizeSourceRecord,
  parseRingWebhook,
  verifyRingSignature,
  PlaygroundCapture,
  RING_SIGNATURE_HEADER,
} from "@seqseal/ring-adapter";
import type { ArtifactStore } from "./artifacts";
import { makeEvent, type EventSink } from "./bus";
import { buildReceipt } from "./receipt";
import type { DocDatabase } from "./store/doc";
import { SeqSealStore } from "./store/repository";

export interface PipelineConfig {
  protocol: CompiledProtocol;
  policy: ActionPolicy;
  sources: SourceConfig;
  acceptance: AcceptancePolicy;
}

export interface PipelineOptions {
  /** Delay before a terminal-state execution is finalized (absorbs late deliveries). */
  finalizationGraceMs: number;
  /** Orphan evidence occurring up to this long before an opening state is adopted. */
  orphanSkewMs: number;
  /** After finalization, evidence within this window after the last evidence is routed back as late evidence. */
  lateWindowMs: number;
  ringSigningSecret?: string;
  requireSignatureFor: SourceProfile[];
  /** Test-only fault injection for B16/B17 (never enabled in deployed environments). */
  faults?: { engine?: boolean; gate?: boolean };
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
const SENSITIVE_KEY = /(token|secret|password|authorization|signature|api[_-]?key|cookie)/i;
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/g;

/** Recursively mask secret-looking fields and bearer tokens before anything reaches the logs. */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(BEARER, "$1 [redacted]");
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redactForLog(v, depth + 1)]),
    );
  }
  return value;
}

export const jsonLogger = (service: string): Logger => {
  const log = (level: string) => (msg: string, fields: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ level, service, msg, ...(redactForLog(fields) as Record<string, unknown>), ts: new Date().toISOString() }));
  return { info: log("info"), warn: log("warn"), error: log("error") };
};

export interface PipelineDeps {
  db: DocDatabase;
  config: PipelineConfig;
  interpreter: EvidenceInterpreter;
  sink: EventSink;
  artifacts?: ArtifactStore;
  clock?: () => string;
  options?: Partial<PipelineOptions>;
  logger?: Logger;
  /** Infrastructure errors that should propagate for queue retry instead of becoming SYSTEM_ERROR. */
  isRetryable?: (err: unknown) => boolean;
}

export type IngestOutcome = "ACCEPTED" | "DUPLICATE_DELIVERY" | "INVALID_SIGNATURE" | "MALFORMED";
export interface IngestResult {
  status: 200 | 202 | 400 | 401;
  outcome: IngestOutcome;
  source_record_id?: string;
  correlation_id?: string;
  error?: string;
}

/** Health-window key: replay runs are isolated "sites". */
export function healthKey(device: string, replay?: { run_id: string }): string {
  return replay ? `run:${replay.run_id}:${device}` : device;
}

class StepFault extends Error {
  constructor(
    readonly code: SystemErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StepFault";
  }
}

/**
 * The SEQSEAL domain pipeline. Each step consumes one domain event and returns the
 * events it produced; the same code runs in-process (LocalRuntime) and in Lambda.
 *
 * Authority is fragmented on purpose:
 *   source → observation → evidence → engine verdict → policy decision → gate action → receipt
 */
export class SeqSealPipeline {
  readonly store: SeqSealStore;
  readonly config: PipelineConfig;
  readonly options: PipelineOptions;
  private readonly clock: () => string;
  private readonly log: Logger;

  constructor(private readonly deps: PipelineDeps) {
    this.store = new SeqSealStore(deps.db);
    this.config = deps.config;
    this.clock = deps.clock ?? (() => new Date().toISOString());
    this.log = deps.logger ?? silentLogger;
    this.options = {
      finalizationGraceMs: 0,
      orphanSkewMs: 10 * 60_000,
      lateWindowMs: 15 * 60_000,
      requireSignatureFor: ["RING_WEBHOOK", "RING_STAGING"],
      ...deps.options,
    };
  }

  private get protocol() {
    return this.config.protocol;
  }

  private async emit(events: DomainEvent[]): Promise<DomainEvent[]> {
    for (const e of events) await this.store.appendEvent(e);
    if (events.length) await this.deps.sink.publish(events);
    return events;
  }

  private ev(name: EventName, correlation_id: string, payload: Record<string, unknown>, execution_id?: string): DomainEvent {
    return makeEvent(name, { correlation_id, payload, occurred_at: this.clock(), ...(execution_id ? { execution_id } : {}) });
  }

  laneFor(replay?: { run_id: string }): string {
    return replay ? `${this.config.sources.lane}:run:${replay.run_id}` : this.config.sources.lane;
  }

  /* ═════════════════════════ 1. Ingestion (source authority) ═════════════════════════ */

  /**
   * Ring webhook ingress (Doc 04 §19): verify signature over RAW bytes, establish delivery
   * idempotency, persist the raw record, publish, return fast. No AI, no evaluation here.
   */
  async ingestWebhook(input: {
    rawBody: string;
    headers?: Record<string, string | undefined>;
    profile: SourceProfile;
    replay?: { run_id: string; scenario_id: string; label?: string };
  }): Promise<IngestResult> {
    const needsSig = this.options.requireSignatureFor.includes(input.profile);
    let verified = false;
    if (needsSig) {
      verified = verifyRingSignature(input.rawBody, headerValue(input.headers, RING_SIGNATURE_HEADER), this.options.ringSigningSecret ?? "");
      if (!verified) {
        this.log.warn("ring_signature_rejected", { profile: input.profile });
        return { status: 401, outcome: "INVALID_SIGNATURE", error: "Invalid or missing X-Signature" };
      }
    }
    let body: unknown;
    try {
      body = JSON.parse(input.rawBody);
    } catch {
      return { status: 400, outcome: "MALFORMED", error: "Body is not JSON" };
    }
    const parsed = parseRingWebhook(body);
    if (!parsed.ok) return { status: 400, outcome: "MALFORMED", error: parsed.error };

    const key = deliveryIdempotencyKey(input.profile, parsed.event.request_id, input.replay?.run_id);
    const claimed = await this.store.claim(key, { kind: "delivery" });
    const ids = this.idsFor(key);
    if (!claimed) return { status: 200, outcome: "DUPLICATE_DELIVERY", source_record_id: ids.record, correlation_id: ids.correlation };

    const record: RawSourceRecord = {
      source_record_id: ids.record,
      provider: input.profile === "FIXTURE_REPLAY" ? "fixture" : input.profile === "CUSTOM_MEDIA" ? "custom" : "ring",
      source_profile: input.profile,
      idempotency_key: key,
      request_ref: parsed.event.request_id,
      source_event_ref: parsed.event.event_id,
      received_at: this.clock(),
      signature_verified: verified,
      correlation_id: ids.correlation,
      payload: body,
      ...(input.replay ? { replay: input.replay } : {}),
    };
    await this.store.putRawRecord(record);
    await this.emit([this.ev("RingSourceEventReceived", ids.correlation, { source_record_id: record.source_record_id, source_profile: input.profile })]);
    return { status: 202, outcome: "ACCEPTED", source_record_id: record.source_record_id, correlation_id: ids.correlation };
  }

  /** Ring Developer Playground capture (actual Ring API call recorded as provenance). */
  async ingestPlaygroundCapture(
    capture: unknown,
    replay?: { run_id: string; scenario_id: string; label?: string },
    profile: "RING_PLAYGROUND" | "RING_DERIVED_REPLAY" = "RING_PLAYGROUND",
  ): Promise<IngestResult> {
    const parsed = PlaygroundCapture.safeParse(capture);
    if (!parsed.success) return { status: 400, outcome: "MALFORMED", error: parsed.error.message };
    const key = deliveryIdempotencyKey(profile, parsed.data.capture_id, replay?.run_id);
    const ids = this.idsFor(key);
    if (!(await this.store.claim(key, { kind: "playground" }))) {
      return { status: 200, outcome: "DUPLICATE_DELIVERY", source_record_id: ids.record, correlation_id: ids.correlation };
    }
    const record: RawSourceRecord = {
      source_record_id: ids.record,
      provider: "ring",
      source_profile: profile,
      idempotency_key: key,
      ...(parsed.data.api_evidence.request_id ? { request_ref: parsed.data.api_evidence.request_id } : {}),
      source_event_ref: parsed.data.ring_event?.event_id ?? parsed.data.capture_id,
      received_at: this.clock(),
      signature_verified: false,
      correlation_id: ids.correlation,
      payload: parsed.data,
      ...(replay ? { replay } : {}),
    };
    await this.store.putRawRecord(record);
    await this.emit([this.ev("RingSourceEventReceived", ids.correlation, { source_record_id: record.source_record_id, source_profile: profile })]);
    return { status: 202, outcome: "ACCEPTED", source_record_id: record.source_record_id, correlation_id: ids.correlation };
  }

  private idsFor(key: string) {
    const h = sha256Hex(key);
    return { record: `SRC-${h.slice(0, 12)}`, correlation: `COR-${h.slice(12, 24)}` };
  }

  /* ═════════════════════════ 2. Normalization ═════════════════════════ */

  async onSourceEventReceived(evt: DomainEvent): Promise<DomainEvent[]> {
    const record = await this.store.getRawRecord(String(evt.payload.source_record_id));
    if (!record) throw new Error(`Raw record ${String(evt.payload.source_record_id)} not found`);
    const n = normalizeSourceRecord(record);
    if (!n.ok) {
      return this.emit([this.ev("SystemError", record.correlation_id, { code: "NORMALIZATION_ERROR", message: n.error, source_record_id: record.source_record_id })]);
    }
    if (!(await this.store.claim(n.eventKey, { kind: "event" }))) {
      this.log.info("duplicate_ring_event_ignored", { event_key: n.eventKey });
      return [];
    }
    const obs = n.observation;
    // Bind physical observations (and health events, for coverage) to a logical zone.
    const match = bindObservation(obs, this.config.sources.bindings);
    if (match.binding) {
      obs.logical_zone = match.binding.logical_zone;
      obs.binding_id = match.binding.binding_id;
    } else if (match.ambiguous) {
      obs.attributes.binding_ambiguity = match.ambiguous.map((b) => b.binding_id);
    }
    const events: DomainEvent[] = [];
    if (obs.family === "INTEGRATION_HEALTH") {
      const key = healthKey(obs.source_device_ref ?? obs.observation_id, obs.replay);
      if (obs.source_health === "HEALTHY") await this.store.closeOpenHealthWindows(key, obs.occurred_at);
      else {
        await this.store.putHealthWindow({
          source_key: key,
          ...(obs.logical_zone ? { logical_zone: obs.logical_zone } : {}),
          status: obs.source_health,
          from: obs.occurred_at,
          reason: obs.event_type,
          observation_ref: obs.observation_id,
        });
      }
      obs.attributes.resolution = "Integration-health observation: coverage input, never workflow evidence.";
      events.push(this.ev("SourceHealthChanged", obs.correlation_id, { observation_id: obs.observation_id, source_key: key, status: obs.source_health, lane: this.laneFor(obs.replay) }));
    }
    await this.store.putObservation(obs);
    events.push(this.ev("ObservationNormalized", obs.correlation_id, { observation_id: obs.observation_id, family: obs.family, event_type: obs.event_type }));
    return this.emit(events);
  }

  /* ═════════════════════════ 3. Evidence resolution ═════════════════════════ */

  async onObservationNormalized(evt: DomainEvent): Promise<DomainEvent[]> {
    const obs = await this.store.getObservation(String(evt.payload.observation_id));
    if (!obs) throw new Error(`Observation ${String(evt.payload.observation_id)} not found`);
    const res = resolveObservation(obs, this.config.sources, this.protocol, this.clock());
    switch (res.kind) {
      case "NOT_EVIDENCE":
      case "UNBOUND":
      case "NO_MAPPING":
        if (obs.family !== "INTEGRATION_HEALTH") {
          obs.attributes.resolution = res.reason;
          await this.store.putObservation(obs);
        }
        return [];
      case "NEEDS_INTERPRETATION":
        return this.emit([this.ev("EvidenceInterpretationRequested", obs.correlation_id, { observation_id: obs.observation_id, mapping_id: res.draft.mapping.mapping_id, state: res.draft.state })]);
      case "CANDIDATE":
        return this.admitCandidate(res.candidate, obs);
    }
  }

  /** AI-assisted evidence: the model can only support, reject or abstain on the proposed state. */
  async onInterpretationRequested(evt: DomainEvent): Promise<DomainEvent[]> {
    const obs = await this.store.getObservation(String(evt.payload.observation_id));
    if (!obs) throw new Error(`Observation ${String(evt.payload.observation_id)} not found`);
    const res = resolveObservation(obs, this.config.sources, this.protocol, this.clock());
    if (res.kind !== "NEEDS_INTERPRETATION") return [];
    const allowed = this.protocol.states.filter((s) => s.zone === res.draft.logical_zone).map((s) => s.id);
    let candidate: EvidenceCandidate;
    try {
      const result = await this.deps.interpreter.interpret({
        request_id: `INT-${obs.observation_id}`,
        observation: obs,
        logical_zone: res.draft.logical_zone,
        proposed_state: res.draft.state,
        allowed_states: allowed.length ? allowed : [res.draft.state],
        ...(obs.media_session_ref ? { media_ref: obs.media_session_ref } : {}),
      });
      candidate = candidateFromInterpretation(res.draft, result, this.clock());
    } catch (err) {
      if (this.deps.isRetryable?.(err)) throw err;
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.log.warn("evidence_interpretation_failed", { observation_id: obs.observation_id, error: msg });
      candidate = candidateFromInterpretation(res.draft, null, this.clock(), msg);
    }
    return this.admitCandidate(candidate, obs);
  }

  /** Acceptance policy → correlation → authoritative evidence (or unresolved candidate). */
  async admitCandidate(candidate: EvidenceCandidate, obs: NormalizedObservation): Promise<DomainEvent[]> {
    if (candidate.status === "CANDIDATE") {
      const acc = applyAcceptance(candidate, this.config.acceptance);
      candidate = { ...candidate, status: acc.status, status_reason: acc.rule_id };
    }
    const events: DomainEvent[] = [];
    const lane = this.laneFor(obs.replay);
    const correlation = await this.correlate(candidate, obs, lane, events);
    candidate = { ...candidate, ...(correlation.executionId ? { execution_id: correlation.executionId } : {}) };
    if (correlation.forceUncertain) candidate = { ...candidate, status: "UNCERTAIN", status_reason: correlation.forceUncertain };
    await this.store.putCandidate(candidate);
    events.push(this.ev("EvidenceCandidateCreated", obs.correlation_id, { candidate_id: candidate.candidate_id, status: candidate.status, state: candidate.semantic_state }, correlation.executionId));

    if (!correlation.executionId) {
      if (candidate.status !== "REJECTED") {
        await this.store.putOrphan(lane, { kind: "CAN", id: candidate.candidate_id, occurred_at: candidate.occurred_at, state: candidate.semantic_state });
      }
      return this.emit(events);
    }
    events.push(...(await this.attachCandidate(correlation.executionId, candidate, obs.correlation_id)));
    return this.emit(events);
  }

  private async attachCandidate(executionId: string, candidate: EvidenceCandidate, correlationId: string): Promise<DomainEvent[]> {
    const profiles = candidate.source_refs.map((s) => s.source_profile);
    if (candidate.status === "ACCEPTED") {
      const evidence: Evidence = {
        evidence_id: evidenceIdFor(candidate.candidate_id),
        candidate_id: candidate.candidate_id,
        execution_id: executionId,
        semantic_state: candidate.semantic_state,
        occurred_at: candidate.occurred_at,
        time_precision_ms: candidate.time_precision_ms ?? 0,
        logical_zone: candidate.logical_zone,
        interpretation_mode: candidate.interpretation_mode,
        ...(candidate.quality ? { quality: candidate.quality } : {}),
        ...(candidate.model_id ? { model_id: candidate.model_id } : {}),
        observation_refs: candidate.observation_refs,
        source_refs: candidate.source_refs,
        resolver_version: candidate.resolver_version,
        acceptance_rule: candidate.status_reason ?? "ACCEPTED",
        accepted_at: this.clock(),
      };
      if (!(await this.store.putEvidence(evidence))) return [];
      await this.store.updateExecution(executionId, (e) => {
        if (!e.evidence_ids.includes(evidence.evidence_id)) e.evidence_ids.push(evidence.evidence_id);
        for (const p of profiles) if (!e.source_profiles.includes(p)) e.source_profiles.push(p);
        e.updated_at = this.clock();
      });
      return [this.ev("EvidenceAccepted", correlationId, { evidence_id: evidence.evidence_id, state: evidence.semantic_state }, executionId)];
    }
    await this.store.updateExecution(executionId, (e) => {
      if (!e.candidate_ids.includes(candidate.candidate_id)) e.candidate_ids.push(candidate.candidate_id);
      for (const p of profiles) if (!e.source_profiles.includes(p)) e.source_profiles.push(p);
      e.updated_at = this.clock();
    });
    if (candidate.status === "UNCERTAIN" || candidate.status === "MEDIA_PENDING") {
      return [this.ev("EvidenceUnresolved", correlationId, { candidate_id: candidate.candidate_id, state: candidate.semantic_state }, executionId)];
    }
    return [];
  }

  /**
   * Execution correlation (Doc 03 §23–24): the opening state opens an execution when the
   * lane is free; everything else attaches to the active execution; a second independent
   * opening while active is CORRELATION_AMBIGUITY (never a guessed actor).
   */
  private async correlate(
    candidate: EvidenceCandidate,
    obs: NormalizedObservation,
    lane: string,
    events: DomainEvent[],
  ): Promise<{ executionId?: string; forceUncertain?: string }> {
    const opening = this.protocol.openingState;
    const activeId = await this.store.getActiveExecutionId(lane);

    if (candidate.semantic_state === opening && candidate.status === "ACCEPTED") {
      if (!activeId) {
        const id = await this.openExecution(candidate, obs, lane, events);
        if (id) return { executionId: id };
      }
      const current = activeId ?? (await this.store.getActiveExecutionId(lane));
      if (current) {
        const item: UncertaintyItem = {
          kind: "CORRELATION_AMBIGUITY",
          state: opening,
          rule_ids: [],
          refs: [candidate.candidate_id],
          material: true,
          detail: `A second independent ${opening.toUpperCase()} was observed while ${current} is active; observations cannot be reliably assigned.`,
        };
        await this.store.updateExecution(current, (e) => {
          e.uncertainty.push(item);
          e.updated_at = this.clock();
        });
        events.push(this.ev("CorrelationAmbiguityDetected", obs.correlation_id, { candidate_id: candidate.candidate_id }, current));
        return { executionId: current, forceUncertain: "CORRELATION_AMBIGUITY" };
      }
    }
    if (activeId) return { executionId: activeId };

    // No active execution: late evidence for the most recently finalized one (→ amendment)?
    const last = await this.store.getLastFinalized(lane);
    if (last && candidate.occurred_at >= last.opened_at && candidate.occurred_at <= last.window_end) {
      return { executionId: last.execution_id };
    }
    return {};
  }

  private async openExecution(candidate: EvidenceCandidate, obs: NormalizedObservation, lane: string, events: DomainEvent[]): Promise<string | undefined> {
    const number = await this.store.nextExecutionNumber();
    const id = `EXEC-${pad(number)}`;
    if (!(await this.store.claimLane(lane, id))) return undefined;
    const now = this.clock();
    const execution: Execution = {
      execution_id: id,
      number,
      lane,
      protocol_ref: this.protocol.ref,
      protocol_hash: this.protocol.hash,
      action_policy_ref: this.config.policy.ref,
      source_config_hash: this.config.sources.hash,
      status: "ACTIVE",
      opened_at: candidate.occurred_at,
      opened_by_evidence: evidenceIdFor(candidate.candidate_id),
      created_at: now,
      updated_at: now,
      evidence_ids: [],
      candidate_ids: [],
      uncertainty: [],
      latest_evaluation_seq: 0,
      workflow_status: "PENDING",
      receipt_ids: [],
      source_profiles: [obs.source_profile],
      ...(obs.replay ? { replay: obs.replay } : {}),
      correlation_id: obs.correlation_id,
    };
    await this.store.createExecution(execution);
    events.push(this.ev("ExecutionOpened", obs.correlation_id, { lane, opened_by: candidate.candidate_id }, id));

    // Adopt orphans that occurred around/after the opening (network reordering).
    const threshold = toIso(toMs(candidate.occurred_at) - this.options.orphanSkewMs);
    for (const o of await this.store.listOrphans(lane)) {
      if (o.occurred_at < threshold) continue;
      const c = await this.store.getCandidate(o.id);
      await this.store.deleteOrphan(lane, o);
      if (!c) continue;
      const adopted = { ...c, execution_id: id, updated_at: now };
      await this.store.putCandidate(adopted);
      events.push(...(await this.attachCandidate(id, adopted, obs.correlation_id)));
    }
    return id;
  }

  /* ═════════════════════════ 4. Verification (Sequence Integrity Engine) ═════════════════════════ */

  async evaluate(executionId: string, trigger: string, requested: EvaluationMode = "PROVISIONAL"): Promise<DomainEvent[]> {
    const execution = await this.store.getExecution(executionId);
    if (!execution) throw new Error(`Execution ${executionId} not found`);
    const mode: EvaluationMode = execution.status === "FINALIZED" ? "FINAL" : requested;
    const evidence = await this.store.listExecutionEvidence(executionId);
    const unresolved = (await this.store.listExecutionCandidates(executionId)).filter((c) => c.status === "UNCERTAIN" || c.status === "MEDIA_PENDING");

    // Coverage over the evidence-sensitive window.
    const times = [execution.opened_at, ...evidence.map((e) => e.occurred_at), ...unresolved.map((c) => c.occurred_at)].sort();
    // Health windows are isolated per replay run so simulated outages never leak across runs.
    const devices = [...new Set(this.config.sources.bindings.flatMap((b) => (b.source_device_ref ? [b.source_device_ref] : [])))];
    const windows = (
      await Promise.all(
        devices.map(async (device) => (await this.store.listHealth(healthKey(device, execution.replay))).map((w) => ({ ...w, source_key: device }))),
      )
    ).flat();
    const coverage = computeCoverage({
      zones: this.protocol.zones.map((z) => z.id),
      bindings: this.config.sources.bindings,
      profiles: execution.source_profiles,
      windows,
      from: times[0]!,
      to: times[times.length - 1]!,
    });

    if (this.options.faults?.engine) throw new StepFault("ENGINE_ERROR", "Injected engine fault (test)");
    let result;
    try {
      result = evaluateExecution({ protocol: this.protocol, evidence, unresolved, coverage, ambiguities: execution.uncertainty, mode, engineVersion: ENGINE_VERSION });
    } catch (err) {
      throw new StepFault("ENGINE_ERROR", err instanceof Error ? err.message : String(err));
    }

    const seq = await this.store.nextEvaluationSeq(executionId);
    const evaluation: WorkflowEvaluation = {
      ...result,
      evaluation_id: `EVAL-${pad(execution.number)}-${pad(seq, 2)}`,
      execution_id: executionId,
      seq,
      evaluated_at: this.clock(),
      trigger,
      correlation_id: execution.correlation_id,
    };
    const snapshot: EvaluationInputSnapshot = {
      protocol_ref: this.protocol.ref,
      protocol_hash: this.protocol.hash,
      engine_version: ENGINE_VERSION,
      mode,
      evidence,
      unresolved,
      coverage,
      ambiguities: execution.uncertainty,
    };
    await this.store.putEvaluation(evaluation, snapshot);
    await this.deps.artifacts?.putJson(`evaluations/${evaluation.evaluation_id}.json`, { evaluation, snapshot });

    const firstFinal = mode === "FINAL" && execution.status !== "FINALIZED";
    await this.store.updateExecution(executionId, (e) => {
      e.latest_evaluation_id = evaluation.evaluation_id;
      e.latest_evaluation_seq = seq;
      e.latest_verdict = evaluation.verdict;
      e.latest_integrity = evaluation.integrity_state;
      e.updated_at = this.clock();
      if (firstFinal) {
        e.status = "FINALIZED";
        e.finalized_at = this.clock();
      }
    });
    if (firstFinal) {
      await this.store.releaseLane(execution.lane, executionId);
      const last = evidence.map((e) => e.occurred_at).sort().at(-1) ?? execution.opened_at;
      await this.store.setLastFinalized(execution.lane, {
        execution_id: executionId,
        opened_at: execution.opened_at,
        window_end: toIso(toMs(last) + this.options.lateWindowMs),
      });
    }

    const events = [
      this.ev(
        "WorkflowEvaluated",
        execution.correlation_id,
        { evaluation_id: evaluation.evaluation_id, verdict: evaluation.verdict, mode, primary_rule: evaluation.primary_failures[0] ?? null, trigger },
        executionId,
      ),
    ];
    const terminalObserved = evaluation.observed_sequence.some((s) => this.protocol.terminalStates.includes(s.state));
    if (mode === "PROVISIONAL" && terminalObserved) {
      events.push(this.ev("ExecutionFinalizationRequested", execution.correlation_id, { reason: "TERMINAL_STATE_OBSERVED", grace_ms: this.options.finalizationGraceMs }, executionId));
    }
    return this.emit(events);
  }

  /** Explicit finalization (terminal grace elapsed, deadline sweep or operator close). */
  async finalize(executionId: string, reason: string): Promise<DomainEvent[]> {
    const execution = await this.store.getExecution(executionId);
    if (!execution || execution.status === "FINALIZED") return [];
    if (!(await this.store.claimFinalization(executionId, Date.parse(this.clock())))) {
      this.log.info("finalization_already_in_progress", { execution_id: executionId, reason });
      return [];
    }
    return this.evaluate(executionId, `FINALIZE:${reason}`, "FINAL");
  }

  /* ═════════════════════════ 5. Action policy ═════════════════════════ */

  async decide(evaluationId: string): Promise<DomainEvent[]> {
    const evaluation = await this.store.getEvaluation(evaluationId);
    if (!evaluation) throw new Error(`Evaluation ${evaluationId} not found`);
    let amends: string | undefined;
    if (evaluation.mode === "FINAL") {
      const priorFinal = (await this.store.listDecisions(evaluation.execution_id)).filter((d) => d.final && d.evaluation_seq < evaluation.seq).at(-1);
      if (priorFinal) {
        // An amendment must change something: same verdict on the same evidence set is the same
        // final outcome (e.g. a duplicate finalization), not a new decision or a new receipt.
        const prior = await this.store.getEvaluation(priorFinal.evaluation_id);
        if (prior && prior.verdict === evaluation.verdict && prior.evidence_set_hash === evaluation.evidence_set_hash) {
          this.log.info("final_outcome_unchanged", { evaluation_id: evaluationId, prior_decision_id: priorFinal.decision_id });
          return [];
        }
        amends = priorFinal.decision_id;
      }
    }
    const outcome = policyDecide({ evaluation, policy: this.config.policy, now: this.clock(), ...(amends ? { amends } : {}) });
    if (outcome.kind === "DEFERRED") {
      this.log.info("decision_deferred", { evaluation_id: evaluationId, reason: outcome.reason });
      return [];
    }
    const d = outcome.decision;
    if (!(await this.store.putDecision(d))) return []; // idempotent: no duplicate action event
    return this.emit([this.ev("OperationalDecisionCreated", d.correlation_id, { decision_id: d.decision_id, verdict: d.verdict, action: d.action, final: d.final }, d.execution_id)]);
  }

  /* ═════════════════════════ 6. Operational Gate ═════════════════════════ */

  async applyDecision(decisionId: string): Promise<DomainEvent[]> {
    if (this.options.faults?.gate) throw new StepFault("GATE_ERROR", "Injected Operational Gate fault (test)");
    const d = await this.store.getDecision(decisionId);
    if (!d) throw new Error(`Decision ${decisionId} not found`);
    if (d.action === "RELEASE" && (d.verdict !== "SEALED" || !d.final)) throw new ReleaseInvariantViolation(`${d.verdict}${d.final ? "" : " (provisional)"}`);

    for (let attempt = 0; attempt < 8; attempt++) {
      const { wf, rev } = await this.store.getWorkflow(d.execution_id);
      const current: ReceivingWorkflow = wf ?? {
        execution_id: d.execution_id,
        status: "PENDING",
        final: false,
        applied_decision_ids: [],
        applied_evaluation_seq: 0,
        updated_at: this.clock(),
        history: [],
      };
      if (current.applied_decision_ids.includes(d.decision_id)) return []; // idempotent
      if (d.evaluation_seq <= current.applied_evaluation_seq) {
        this.log.info("stale_decision_superseded", { decision_id: d.decision_id });
        return [];
      }
      if (current.final && !d.amends) {
        this.log.warn("decision_after_final_without_amendment", { decision_id: d.decision_id });
        return [];
      }
      const to = ACTION_TO_STATUS[d.action];
      const changed = to !== current.status;
      const eventName = ACTION_EVENT[d.action];
      const now = this.clock();
      const next: ReceivingWorkflow = {
        ...current,
        status: to,
        final: d.final,
        last_decision_id: d.decision_id,
        applied_decision_ids: [...current.applied_decision_ids, d.decision_id],
        applied_evaluation_seq: d.evaluation_seq,
        updated_at: now,
        history: [
          ...current.history,
          {
            at: now,
            from: current.status,
            to,
            decision_id: d.decision_id,
            evaluation_id: d.evaluation_id,
            verdict: d.verdict,
            action: d.action,
            final: d.final,
            ...(changed ? { event_type: eventName } : {}),
            reason: d.reason,
          },
        ],
      };
      if (!(await this.store.putWorkflow(next, rev))) continue;
      await this.store.updateExecution(d.execution_id, (e) => {
        e.latest_action = d.action;
        e.workflow_status = to;
        e.updated_at = now;
      });
      const events: DomainEvent[] = [];
      if (changed) {
        events.push(
          this.ev(
            eventName,
            d.correlation_id,
            {
              decision_id: d.decision_id,
              verdict: d.verdict,
              action: d.action,
              policy_version: d.action_policy_version,
              primary_rule: d.reason_refs[0] ?? null,
              from: current.status,
              to,
              final: d.final,
            },
            d.execution_id,
          ),
        );
      }
      events.push(this.ev("ActionApplied", d.correlation_id, { decision_id: d.decision_id, final: d.final, status: to }, d.execution_id));
      return this.emit(events);
    }
    throw new StepFault("GATE_ERROR", `Concurrent workflow updates for ${d.execution_id}`);
  }

  /* ═════════════════════════ 7. Receipt ═════════════════════════ */

  async generateReceipt(executionId: string, decisionId: string): Promise<DomainEvent[]> {
    const execution = await this.store.getExecution(executionId);
    const decision = await this.store.getDecision(decisionId);
    if (!execution || !decision || !decision.final) return [];
    const existing = await this.store.listExecutionReceipts(executionId);
    if (existing.some((r) => r.operational_decision_id === decisionId)) return [];
    const evaluation = await this.store.getEvaluation(decision.evaluation_id);
    if (!evaluation) throw new Error(`Evaluation ${decision.evaluation_id} not found`);
    const { wf } = await this.store.getWorkflow(executionId);
    const receipt = buildReceipt({
      execution,
      evaluation,
      decision,
      workflow: wf,
      protocol: this.protocol,
      policy: this.config.policy,
      evidence: await this.store.listExecutionEvidence(executionId),
      version: existing.length + 1,
      ...(existing.length ? { supersedes: existing[existing.length - 1]!.receipt_id } : {}),
      now: this.clock(),
    });
    await this.store.putReceipt(receipt);
    await this.deps.artifacts?.putJson(`receipts/${receipt.receipt_id}.json`, receipt);
    await this.store.updateExecution(executionId, (e) => {
      e.receipt_ids.push(receipt.receipt_id);
      e.updated_at = this.clock();
    });
    return this.emit([
      this.ev("ReceiptGenerated", execution.correlation_id, { receipt_id: receipt.receipt_id, verdict: receipt.verdict, action: receipt.operational_action, receipt_hash: receipt.receipt_hash, version: receipt.receipt_version }, executionId),
    ]);
  }

  /* ═════════════════════════ 8. Human evidence review ═════════════════════════ */

  /**
   * Reviewers act on EVIDENCE, never on the outcome (Doc 03 §55–57). There is no
   * force-release path: confirmation creates HUMAN_CONFIRMED evidence and the
   * deterministic engine re-runs.
   */
  async review(input: { candidate_id: string; action: ReviewAction; reviewer_ref: string; rationale?: string }): Promise<{ review: EvidenceReview; events: DomainEvent[] }> {
    const candidate = await this.store.getCandidate(input.candidate_id);
    if (!candidate || !candidate.execution_id) throw new Error(`Candidate ${input.candidate_id} not attached to an execution`);
    if (candidate.status !== "UNCERTAIN" && candidate.status !== "MEDIA_PENDING") throw new Error(`Candidate ${input.candidate_id} is ${candidate.status}; only unresolved evidence can be reviewed`);
    const now = this.clock();
    const review: EvidenceReview = {
      review_id: `REV-${sha256Hex(`${input.candidate_id}|${now}|${input.action}`).slice(0, 10)}`,
      execution_id: candidate.execution_id,
      candidate_id: candidate.candidate_id,
      action: input.action,
      reviewer_ref: input.reviewer_ref,
      ...(input.rationale ? { rationale: input.rationale } : {}),
      at: now,
    };
    const events: DomainEvent[] = [];
    const reviewIds = [...(candidate.review_ids ?? []), review.review_id];
    if (input.action === "CONFIRM") {
      const evidence: Evidence = {
        evidence_id: evidenceIdFor(candidate.candidate_id, "-H"),
        candidate_id: candidate.candidate_id,
        execution_id: candidate.execution_id,
        semantic_state: candidate.semantic_state,
        occurred_at: candidate.occurred_at,
        time_precision_ms: candidate.time_precision_ms ?? 0,
        logical_zone: candidate.logical_zone,
        interpretation_mode: "HUMAN_CONFIRMED",
        ...(candidate.model_id ? { model_id: candidate.model_id } : {}),
        observation_refs: candidate.observation_refs,
        source_refs: candidate.source_refs,
        resolver_version: candidate.resolver_version,
        acceptance_rule: `HUMAN_REVIEW#${review.review_id}`,
        review_id: review.review_id,
        accepted_at: now,
      };
      review.resulting_evidence_id = evidence.evidence_id;
      // The original AI interpretation is preserved; only the pipeline status changes.
      await this.store.putCandidate({ ...candidate, status: "ACCEPTED", status_reason: `HUMAN_CONFIRMED via ${review.review_id}`, review_ids: reviewIds, updated_at: now });
      await this.store.putEvidence(evidence);
      await this.store.updateExecution(candidate.execution_id, (e) => {
        if (!e.evidence_ids.includes(evidence.evidence_id)) e.evidence_ids.push(evidence.evidence_id);
        e.updated_at = now;
      });
    } else if (input.action === "REJECT") {
      await this.store.putCandidate({ ...candidate, status: "REJECTED", status_reason: `REJECTED via ${review.review_id}`, review_ids: reviewIds, updated_at: now });
    } else {
      await this.store.putCandidate({ ...candidate, review_ids: reviewIds, updated_at: now });
    }
    await this.store.putReview(review);
    const execution = await this.store.getExecution(candidate.execution_id);
    events.push(this.ev("EvidenceReviewed", execution?.correlation_id ?? "COR-review", { review_id: review.review_id, action: input.action, candidate_id: candidate.candidate_id }, candidate.execution_id));
    return { review, events: await this.emit(events) };
  }

  /* ═════════════════════════ Router ═════════════════════════ */

  /**
   * Route one domain event to its step. The AWS deployment wires the same mapping with
   * EventBridge rules → SQS queues → Lambda consumers (Doc 06 §17–20).
   */
  async handle(event: DomainEvent): Promise<DomainEvent[]> {
    const name = event.name as EventName;
    try {
      switch (name) {
        case "RingSourceEventReceived":
          return await this.onSourceEventReceived(event);
        case "ObservationNormalized":
          return await this.onObservationNormalized(event);
        case "EvidenceInterpretationRequested":
          return await this.onInterpretationRequested(event);
        case "EvidenceAccepted":
        case "EvidenceUnresolved":
        case "CorrelationAmbiguityDetected":
          return event.execution_id ? await this.evaluate(event.execution_id, name) : [];
        case "EvidenceReviewed":
          return event.execution_id && event.payload.action !== "LEAVE_UNRESOLVED" ? await this.evaluate(event.execution_id, name) : [];
        case "SourceHealthChanged": {
          const active = await this.store.getActiveExecutionId(String(event.payload.lane));
          return active ? await this.evaluate(active, name) : [];
        }
        case "ExecutionFinalizationRequested":
          return event.execution_id ? await this.finalize(event.execution_id, String(event.payload.reason ?? "REQUESTED")) : [];
        case "WorkflowEvaluated":
          return await this.decide(String(event.payload.evaluation_id));
        case "OperationalDecisionCreated":
          return await this.applyDecision(String(event.payload.decision_id));
        case "ActionApplied":
          return event.payload.final && event.execution_id ? await this.generateReceipt(event.execution_id, String(event.payload.decision_id)) : [];
        default:
          return [];
      }
    } catch (err) {
      if (this.deps.isRetryable?.(err)) throw err;
      return this.recordSystemError(event, err);
    }
  }

  /** Infrastructure failures are system states — never semantic verdicts (Doc 07 §97). */
  private async recordSystemError(event: DomainEvent, err: unknown): Promise<DomainEvent[]> {
    const code: SystemErrorCode =
      err instanceof StepFault
        ? err.code
        : err instanceof ReleaseInvariantViolation
          ? "GATE_ERROR"
          : event.name === "WorkflowEvaluated"
            ? "POLICY_ERROR"
            : event.name === "OperationalDecisionCreated"
              ? "GATE_ERROR"
              : event.name === "ActionApplied"
                ? "RECEIPT_ERROR"
                : event.name === "ObservationNormalized" || event.name === "EvidenceInterpretationRequested"
                  ? "EVIDENCE_ERROR"
                  : event.name === "RingSourceEventReceived"
                    ? "NORMALIZATION_ERROR"
                    : "ENGINE_ERROR";
    const message = err instanceof Error ? err.message : String(err);
    this.log.error("pipeline_step_failed", { step: event.name, code, message, execution_id: event.execution_id });
    if (event.execution_id) {
      await this.store
        .updateExecution(event.execution_id, (e) => {
          e.system_error = { code, message, at: this.clock() };
        })
        .catch(() => undefined);
    }
    return this.emit([this.ev("SystemError", event.correlation_id, { code, message, step: event.name }, event.execution_id)]);
  }
}

export type { OperationalDecision };
