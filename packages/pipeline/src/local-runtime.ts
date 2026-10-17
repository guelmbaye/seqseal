import { randomUUID } from "node:crypto";
import { computeRingSignature, buildReplayDeliveries, ReplayScenario, type ReplayDelivery } from "@seqseal/ring-adapter";
import { MockEvidenceInterpreter, type EvidenceInterpreter } from "@seqseal/evidence-model";
import type { DomainEvent } from "@seqseal/contracts";
import { InMemoryArtifactStore } from "./artifacts";
import { InMemoryBus } from "./bus";
import { loadPipelineConfig } from "./config-loader";
import { SeqSealPipeline, type IngestResult, type PipelineConfig, type PipelineOptions } from "./pipeline";
import { InMemoryDocDatabase } from "./store/doc";

export interface LocalRuntimeOptions {
  config?: PipelineConfig;
  interpreter?: EvidenceInterpreter;
  options?: Partial<PipelineOptions>;
  clock?: () => string;
}

export interface ScenarioRunResult {
  run_id: string;
  scenario_id: string;
  lane: string;
  execution_ids: string[];
  ingest: Array<{ seq: number; kind: ReplayDelivery["kind"]; result: IngestResult }>;
  events: DomainEvent[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * In-process runtime: same pipeline, in-memory tables and an in-process FIFO bus.
 * Powers `pnpm demo` (judge fast path), the benchmark and the end-to-end tests.
 * It is a transport substitute only — verdicts and actions come from the same engines.
 */
export class LocalRuntime {
  readonly db = new InMemoryDocDatabase();
  readonly bus = new InMemoryBus();
  readonly artifacts = new InMemoryArtifactStore();
  readonly pipeline: SeqSealPipeline;
  private draining: Promise<void> = Promise.resolve();

  constructor(private readonly opts: LocalRuntimeOptions = {}) {
    const config = opts.config ?? loadPipelineConfig();
    this.pipeline = new SeqSealPipeline({
      db: this.db,
      config,
      interpreter: opts.interpreter ?? new MockEvidenceInterpreter(),
      sink: this.bus,
      artifacts: this.artifacts,
      ...(opts.clock ? { clock: opts.clock } : {}),
      options: { ringSigningSecret: process.env.RING_WEBHOOK_SIGNING_SECRET ?? "local-dev-signing-secret", ...opts.options },
    });
  }

  get store() {
    return this.pipeline.store;
  }

  /** Process queued events until the bus is empty (serialized). */
  drain(maxSteps = 10_000): Promise<void> {
    this.draining = this.draining.then(async () => {
      let steps = 0;
      while (this.bus.queue.length) {
        if (++steps > maxSteps) throw new Error("LocalRuntime: event loop did not converge");
        const next = this.bus.queue.shift()!;
        await this.pipeline.handle(next);
      }
    });
    return this.draining;
  }

  async ingestWebhook(input: Parameters<SeqSealPipeline["ingestWebhook"]>[0]): Promise<IngestResult> {
    const r = await this.pipeline.ingestWebhook(input);
    await this.drain();
    return r;
  }

  async ingestPlaygroundCapture(
    capture: unknown,
    replay?: { run_id: string; scenario_id: string; label?: string },
    profile: "RING_PLAYGROUND" | "RING_DERIVED_REPLAY" = "RING_PLAYGROUND",
  ): Promise<IngestResult> {
    const r = await this.pipeline.ingestPlaygroundCapture(capture, replay, profile);
    await this.drain();
    return r;
  }

  /**
   * Ring-derived replay (Master Brief §25, demo fallback level 2): Playground captures saved by
   * `scripts/ring-spike.ts capture` are replayed through the normal pipeline, labelled
   * RING_DERIVED_REPLAY, in their own lane so a replay never mixes with live traffic.
   */
  async runCaptures(captures: unknown[], o: { runId?: string; session?: string; delayMs?: number } = {}): Promise<ScenarioRunResult> {
    const runId = o.runId ?? `rdr-${randomUUID().slice(0, 8)}`;
    const replay = { run_id: runId, scenario_id: `ring-derived:${o.session ?? "session"}`, label: `Ring-derived replay — ${o.session ?? "captured session"}` };
    const lane = this.pipeline.laneFor(replay);
    const before = this.bus.published.length;
    const ingest: ScenarioRunResult["ingest"] = [];
    let seq = 0;
    for (const c of captures) {
      const r = await this.ingestPlaygroundCapture(c, replay, "RING_DERIVED_REPLAY");
      ingest.push({ seq: ++seq, kind: "original", result: r });
      if (o.delayMs) await sleep(o.delayMs);
    }
    const executionIds = [...new Set(this.bus.published.slice(before).flatMap((e) => (e.execution_id ? [e.execution_id] : [])))];
    return { run_id: runId, scenario_id: replay.scenario_id, lane, execution_ids: executionIds, ingest, events: this.bus.published.slice(before) };
  }

  async finalize(executionId: string, reason = "OPERATOR_CLOSE") {
    await this.pipeline.finalize(executionId, reason);
    await this.drain();
  }

  async review(input: Parameters<SeqSealPipeline["review"]>[0]) {
    const r = await this.pipeline.review(input);
    await this.drain();
    return r.review;
  }

  /**
   * Replay a fixture scenario through the full pipeline. Optional `delayMs` paces
   * deliveries so the UI can show the execution progressing in real time.
   */
  async runScenario(input: unknown, o: { runId?: string; delayMs?: number; signingSecret?: string; onDelivery?: (d: ReplayDelivery, r: IngestResult) => void } = {}): Promise<ScenarioRunResult> {
    const scenario = ReplayScenario.parse(input);
    const runId = o.runId ?? `run-${randomUUID().slice(0, 8)}`;
    const replay = { run_id: runId, scenario_id: scenario.scenario_id, label: scenario.label };
    const lane = this.pipeline.laneFor(replay);
    const deliveries = buildReplayDeliveries(scenario, { runId, accountId: "fixture-account" });
    const before = this.bus.published.length;
    const ingest: ScenarioRunResult["ingest"] = [];
    const secret = o.signingSecret ?? this.pipeline.options.ringSigningSecret ?? "";
    const profile = scenario.source_profile;

    const deliver = async (d: ReplayDelivery) => {
      const headers: Record<string, string> = {};
      if (profile === "RING_WEBHOOK" || profile === "RING_STAGING") {
        headers["X-Signature"] = scenario.signature === "invalid" ? computeRingSignature(d.rawBody, "wrong-secret") : computeRingSignature(d.rawBody, secret);
      }
      const r = await this.ingestWebhook({ rawBody: d.rawBody, headers, profile, replay });
      ingest.push({ seq: d.seq, kind: d.kind, result: r });
      o.onDelivery?.(d, r);
      if (o.delayMs) await sleep(o.delayMs);
    };

    for (const d of deliveries.filter((x) => x.phase === "main")) await deliver(d);
    if (scenario.finalize_at_end || scenario.late_after_finalize.length) {
      const active = await this.store.getActiveExecutionId(lane);
      if (active) {
        await this.pipeline.finalize(active, "DEADLINE_REACHED");
        await this.drain();
      }
    }
    for (const d of deliveries.filter((x) => x.phase === "after_finalize")) await deliver(d);

    const executionIds = [...new Set(this.bus.published.slice(before).flatMap((e) => (e.execution_id ? [e.execution_id] : [])))];
    return { run_id: runId, scenario_id: scenario.scenario_id, lane, execution_ids: executionIds, ingest, events: this.bus.published.slice(before) };
  }
}
