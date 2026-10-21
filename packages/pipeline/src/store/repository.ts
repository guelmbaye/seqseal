import {
  pad,
  type DomainEvent,
  type EvaluationInputSnapshot,
  type Evidence,
  type EvidenceCandidate,
  type EvidenceReview,
  type Execution,
  type NormalizedObservation,
  type OperationalDecision,
  type RawSourceRecord,
  type ReceivingWorkflow,
  type SeqSealReceipt,
  type SourceHealthWindow,
  type WorkflowEvaluation,
} from "@seqseal/contracts";
import type { DocDatabase, DocItem } from "./doc";

/** Orphan evidence waiting for an execution to open (network reordering, Doc 04 §75). */
export interface OrphanRef {
  kind: "EV" | "CAN";
  id: string;
  occurred_at: string;
  state: string;
}

export interface LaneFinalized {
  execution_id: string;
  opened_at: string;
  window_end: string;
}

const doc = <T>(item: DocItem | undefined): T | undefined => (item ? (item.doc as T) : undefined);
const docs = <T>(items: DocItem[]): T[] => items.map((i) => i.doc as T);

/**
 * Domain repository over the generic document tables.
 *
 * executions table   EXECUTIONS / EXEC#<id>       execution summary (rev for optimistic concurrency)
 *                    EXEC#<id> / EVAL#nn · DEC#nn · WORKFLOW · RECEIPT#vNNN · REVIEW#… · EVENT#… · SNAPSHOT#nn
 *                    EVAL#<id>, DEC#<id>, RECEIPT#<id> / META   direct lookups
 *                    RECEIPTS / <receipt_id>, EVENTS / <time>#<id>   global indexes
 * evidence table     RAW#… · OBS#… · CAN#… · EV#… / META, EXEC#<id> / EV#… · CAN#…   membership
 *                    OBSERVATIONS / <received>#<id>, ORPHANS#<lane> / <time>#<id>, HEALTH#<source> / <from>
 * config table       COUNTER / EXECUTION, LANE#<lane> / ACTIVE · LAST_FINALIZED
 * idempotency table  <key> / -
 */
export class SeqSealStore {
  constructor(private readonly db: DocDatabase) {}

  private get ex() {
    return this.db.table("executions");
  }
  private get evd() {
    return this.db.table("evidence");
  }
  private get cfg() {
    return this.db.table("config");
  }
  private get idem() {
    return this.db.table("idempotency");
  }

  /* ── idempotency ── */
  async claim(key: string, meta: Record<string, unknown> = {}): Promise<boolean> {
    // expires_at: DynamoDB TTL (idempotency keys are kept 7 days).
    return this.idem.put({ pk: key, sk: "-", at: new Date().toISOString(), expires_at: Math.floor(Date.now() / 1000) + 7 * 86_400, ...meta }, { ifNotExists: true });
  }
  async isClaimed(key: string): Promise<boolean> {
    return !!(await this.idem.get(key, "-"));
  }

  /* ── source records & observations ── */
  async putRawRecord(r: RawSourceRecord) {
    await this.evd.put({ pk: `RAW#${r.source_record_id}`, sk: "META", doc: r });
  }
  async getRawRecord(id: string) {
    return doc<RawSourceRecord>(await this.evd.get(`RAW#${id}`, "META"));
  }
  async putObservation(o: NormalizedObservation) {
    await this.evd.put({ pk: `OBS#${o.observation_id}`, sk: "META", doc: o });
    await this.evd.put({ pk: "OBSERVATIONS", sk: `${o.received_at}#${o.observation_id}`, doc: o });
  }
  async getObservation(id: string) {
    return doc<NormalizedObservation>(await this.evd.get(`OBS#${id}`, "META"));
  }
  async listRecentObservations(limit = 50) {
    return docs<NormalizedObservation>(await this.evd.query("OBSERVATIONS", { descending: true, limit }));
  }

  /* ── candidates & evidence ── */
  async putCandidate(c: EvidenceCandidate) {
    await this.evd.put({ pk: `CAN#${c.candidate_id}`, sk: "META", doc: c });
    if (c.execution_id) await this.evd.put({ pk: `EXEC#${c.execution_id}`, sk: `CAN#${c.candidate_id}`, doc: c });
  }
  async getCandidate(id: string) {
    return doc<EvidenceCandidate>(await this.evd.get(`CAN#${id}`, "META"));
  }
  async listExecutionCandidates(executionId: string) {
    return docs<EvidenceCandidate>(await this.evd.query(`EXEC#${executionId}`, { prefix: "CAN#" }));
  }
  /** Returns false when the evidence id already exists (idempotent acceptance). */
  async putEvidence(e: Evidence): Promise<boolean> {
    const created = await this.evd.put({ pk: `EV#${e.evidence_id}`, sk: "META", doc: e }, { ifNotExists: true });
    if (created) await this.evd.put({ pk: `EXEC#${e.execution_id}`, sk: `EV#${e.evidence_id}`, doc: e });
    return created;
  }
  async getEvidence(id: string) {
    return doc<Evidence>(await this.evd.get(`EV#${id}`, "META"));
  }
  async listExecutionEvidence(executionId: string) {
    return docs<Evidence>(await this.evd.query(`EXEC#${executionId}`, { prefix: "EV#" }));
  }

  /* ── orphans ── */
  async putOrphan(lane: string, ref: OrphanRef) {
    await this.evd.put({ pk: `ORPHANS#${lane}`, sk: `${ref.occurred_at}#${ref.id}`, doc: ref });
  }
  async listOrphans(lane: string) {
    return docs<OrphanRef>(await this.evd.query(`ORPHANS#${lane}`));
  }
  async deleteOrphan(lane: string, ref: OrphanRef) {
    await this.evd.delete(`ORPHANS#${lane}`, `${ref.occurred_at}#${ref.id}`);
  }

  /* ── source health ── */
  async putHealthWindow(w: SourceHealthWindow) {
    await this.evd.put({ pk: `HEALTH#${w.source_key}`, sk: w.from, doc: w });
  }
  async listHealth(sourceKey: string) {
    return docs<SourceHealthWindow>(await this.evd.query(`HEALTH#${sourceKey}`));
  }
  /** Close the currently open unhealthy window (if any) at `to`. */
  async closeOpenHealthWindows(sourceKey: string, to: string) {
    for (const w of await this.listHealth(sourceKey)) {
      if (w.to === undefined && w.status !== "HEALTHY" && w.from <= to) await this.putHealthWindow({ ...w, to });
    }
  }

  /* ── executions ── */
  async nextExecutionNumber(): Promise<number> {
    return this.cfg.increment("COUNTER", "EXECUTION", "value");
  }
  async createExecution(e: Execution): Promise<boolean> {
    return this.ex.put({ pk: "EXECUTIONS", sk: `EXEC#${e.execution_id}`, rev: 1, doc: e }, { ifNotExists: true });
  }
  async getExecution(id: string) {
    return doc<Execution>(await this.ex.get("EXECUTIONS", `EXEC#${id}`));
  }
  async listExecutions(limit = 50) {
    return docs<Execution>(await this.ex.query("EXECUTIONS", { descending: true, limit }));
  }
  /** Optimistic read-modify-write with bounded retries. */
  async updateExecution(id: string, mutate: (e: Execution) => Execution | void, attempts = 8): Promise<Execution> {
    for (let i = 0; i < attempts; i++) {
      const item = await this.ex.get("EXECUTIONS", `EXEC#${id}`);
      if (!item) throw new Error(`Execution ${id} not found`);
      const rev = (item.rev as number) ?? 0;
      const current = structuredClone(item.doc as Execution);
      const next = mutate(current) ?? current;
      const ok = await this.ex.put({ pk: "EXECUTIONS", sk: `EXEC#${id}`, rev: rev + 1, doc: next }, { condition: { attr: "rev", op: "eq", value: rev } });
      if (ok) return next;
    }
    throw new Error(`Execution ${id}: concurrent update retries exhausted`);
  }

  /**
   * Lease on the first finalization of an execution. On AWS several Lambdas may receive a
   * finalization request for the same execution at once (one per provisional evaluation that saw
   * the terminal state). Only the holder of the lease finalizes; an expired lease (holder crashed)
   * can be taken again, e.g. by the sweeper.
   */
  async claimFinalization(executionId: string, nowMs: number, leaseMs = 60_000): Promise<boolean> {
    return this.ex.put(
      { pk: `EXEC#${executionId}`, sk: "FINALIZE_LEASE", until: nowMs + leaseMs },
      { condition: { attr: "until", op: "absentOrLt", value: nowMs } },
    );
  }

  /* ── lanes ── */
  async getActiveExecutionId(lane: string): Promise<string | undefined> {
    return (await this.cfg.get(`LANE#${lane}`, "ACTIVE"))?.execution_id as string | undefined;
  }
  async claimLane(lane: string, executionId: string): Promise<boolean> {
    return this.cfg.put({ pk: `LANE#${lane}`, sk: "ACTIVE", execution_id: executionId }, { ifNotExists: true });
  }
  async releaseLane(lane: string, executionId: string): Promise<boolean> {
    return this.cfg.delete(`LANE#${lane}`, "ACTIVE", { condition: { attr: "execution_id", op: "eq", value: executionId } });
  }
  async setLastFinalized(lane: string, v: LaneFinalized) {
    await this.cfg.put({ pk: `LANE#${lane}`, sk: "LAST_FINALIZED", doc: v });
  }
  async getLastFinalized(lane: string) {
    return doc<LaneFinalized>(await this.cfg.get(`LANE#${lane}`, "LAST_FINALIZED"));
  }

  /* ── evaluations ── */
  async nextEvaluationSeq(executionId: string): Promise<number> {
    return this.ex.increment(`EXEC#${executionId}`, "COUNTER", "evaluations");
  }
  async putEvaluation(e: WorkflowEvaluation, snapshot: EvaluationInputSnapshot) {
    await this.ex.put({ pk: `EXEC#${e.execution_id}`, sk: `EVAL#${pad(e.seq, 3)}`, doc: e });
    await this.ex.put({ pk: `EVAL#${e.evaluation_id}`, sk: "META", doc: e });
    await this.ex.put({ pk: `EXEC#${e.execution_id}`, sk: `SNAPSHOT#${pad(e.seq, 3)}`, evaluation_id: e.evaluation_id, doc: snapshot });
    await this.ex.put({ pk: `SNAPSHOT#${e.evaluation_id}`, sk: "META", doc: snapshot });
  }
  async getEvaluation(id: string) {
    return doc<WorkflowEvaluation>(await this.ex.get(`EVAL#${id}`, "META"));
  }
  async getSnapshot(evaluationId: string) {
    return doc<EvaluationInputSnapshot>(await this.ex.get(`SNAPSHOT#${evaluationId}`, "META"));
  }
  async listEvaluations(executionId: string) {
    return docs<WorkflowEvaluation>(await this.ex.query(`EXEC#${executionId}`, { prefix: "EVAL#" }));
  }

  /* ── decisions ── */
  async putDecision(d: OperationalDecision): Promise<boolean> {
    const created = await this.ex.put({ pk: `DEC#${d.decision_id}`, sk: "META", doc: d }, { ifNotExists: true });
    if (created) await this.ex.put({ pk: `EXEC#${d.execution_id}`, sk: `DEC#${pad(d.evaluation_seq, 3)}`, doc: d });
    return created;
  }
  async getDecision(id: string) {
    return doc<OperationalDecision>(await this.ex.get(`DEC#${id}`, "META"));
  }
  async listDecisions(executionId: string) {
    return docs<OperationalDecision>(await this.ex.query(`EXEC#${executionId}`, { prefix: "DEC#" }));
  }

  /* ── receiving workflow projection ── */
  async getWorkflow(executionId: string): Promise<{ wf?: ReceivingWorkflow; rev: number }> {
    const item = await this.ex.get(`EXEC#${executionId}`, "WORKFLOW");
    return { wf: doc<ReceivingWorkflow>(item), rev: (item?.rev as number) ?? 0 };
  }
  async putWorkflow(wf: ReceivingWorkflow, expectedRev: number): Promise<boolean> {
    return this.ex.put(
      { pk: `EXEC#${wf.execution_id}`, sk: "WORKFLOW", rev: expectedRev + 1, doc: wf },
      { condition: { attr: "rev", op: "absentOrEq", value: expectedRev === 0 ? undefined : expectedRev } },
    );
  }

  /* ── receipts ── */
  async putReceipt(r: SeqSealReceipt) {
    await this.ex.put({ pk: `EXEC#${r.execution_id}`, sk: `RECEIPT#v${pad(r.receipt_version, 3)}`, doc: r });
    await this.ex.put({ pk: `RECEIPT#${r.receipt_id}`, sk: "META", doc: r });
    await this.ex.put({ pk: "RECEIPTS", sk: `${r.generated_at}#${r.receipt_id}`, doc: r });
  }
  async getReceipt(id: string) {
    return doc<SeqSealReceipt>(await this.ex.get(`RECEIPT#${id}`, "META"));
  }
  async listReceipts(limit = 50) {
    return docs<SeqSealReceipt>(await this.ex.query("RECEIPTS", { descending: true, limit }));
  }
  async listExecutionReceipts(executionId: string) {
    return docs<SeqSealReceipt>(await this.ex.query(`EXEC#${executionId}`, { prefix: "RECEIPT#" }));
  }

  /* ── reviews ── */
  async putReview(r: EvidenceReview) {
    await this.ex.put({ pk: `EXEC#${r.execution_id}`, sk: `REVIEW#${r.at}#${r.review_id}`, doc: r });
  }
  async listReviews(executionId: string) {
    return docs<EvidenceReview>(await this.ex.query(`EXEC#${executionId}`, { prefix: "REVIEW#" }));
  }

  /* ── domain event log (audit trail + UI timeline) ── */
  async appendEvent(e: DomainEvent) {
    await this.ex.put({ pk: "EVENTS", sk: `${e.occurred_at}#${e.event_id}`, doc: e });
    if (e.execution_id) await this.ex.put({ pk: `EXEC#${e.execution_id}`, sk: `EVENT#${e.occurred_at}#${e.event_id}`, doc: e });
  }
  async listEvents(limit = 100) {
    return docs<DomainEvent>(await this.ex.query("EVENTS", { descending: true, limit }));
  }
  async listExecutionEvents(executionId: string) {
    return docs<DomainEvent>(await this.ex.query(`EXEC#${executionId}`, { prefix: "EVENT#" }));
  }
}
