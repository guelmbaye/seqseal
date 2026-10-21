/**
 * AWS delivers events to Lambdas in parallel, at least once. These tests deliver the real
 * pipeline's events the same way (every in-flight event at once, a fresh pipeline per handler, on
 * the real DynamoDB adapter) and pin what the first AWS deployment showed: one delivery must give
 * one final evaluation, one final decision and one receipt, however many finalization requests
 * arrive together.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@seqseal/contracts";
import { MockEvidenceInterpreter } from "@seqseal/evidence-model";
import { InMemoryBus, loadPipelineConfig, SeqSealPipeline } from "@seqseal/pipeline";
import { DynamoDocDatabase } from "../src";
import { FakeDynamo } from "./fake-dynamo";

const root = join(__dirname, "..", "..", "..");
const session = (name: string) =>
  readFileSync(join(root, "fixtures/ring/captures", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);

function world() {
  const dynamo = new FakeDynamo();
  const config = loadPipelineConfig();
  const bus = new InMemoryBus();
  const pipeline = () =>
    new SeqSealPipeline({
      db: new DynamoDocDatabase({ executions: "ex", evidence: "ev", config: "cfg", idempotency: "idem" }, dynamo),
      config,
      interpreter: new MockEvidenceInterpreter(),
      sink: bus,
      options: { finalizationGraceMs: 5000 }, // as deployed (finalization_grace_seconds = 5)
    });
  /** Every in-flight event delivered at once, each to its own Lambda; repeated until quiet. */
  const drainInParallel = async () => {
    let finalizationRequests = 0;
    while (bus.queue.length) {
      const wave = bus.queue.splice(0);
      finalizationRequests += wave.filter((e) => e.name === "ExecutionFinalizationRequested").length;
      await Promise.all(wave.map((e: DomainEvent) => pipeline().handle(e)));
    }
    return finalizationRequests;
  };
  return { pipeline, drainInParallel };
}

async function replayInParallel(name: string) {
  const w = world();
  const replay = { run_id: `rdr-${name}`, scenario_id: "ring-derived:remote", label: "Ring-derived replay" };
  await Promise.all(session(name).map((c) => w.pipeline().ingestPlaygroundCapture(c, replay, "RING_DERIVED_REPLAY")));
  const finalizationRequests = await w.drainInParallel();
  const store = w.pipeline().store;
  const [exec] = await store.listExecutions();
  return {
    w,
    exec: exec!,
    finalizationRequests,
    finals: (await store.listEvaluations(exec!.execution_id)).filter((e) => e.mode === "FINAL"),
    finalDecisions: (await store.listDecisions(exec!.execution_id)).filter((d) => d.final),
    receipts: await store.listReceipts(),
  };
}

describe("parallel, at-least-once delivery (as on AWS)", () => {
  it.each([
    ["live-2026-10-19-a", "SEALED", "RELEASED"],
    ["live-2026-10-19-b", "DEVIATED", "HELD"],
  ])("%s: several finalization requests at once still give one final evaluation, decision and receipt", async (name, verdict, workflow) => {
    const r = await replayInParallel(name);
    expect(r.finalizationRequests).toBeGreaterThan(1); // the race really happens
    expect([r.exec.latest_verdict, r.exec.workflow_status]).toEqual([verdict, workflow]);
    expect(r.finals).toHaveLength(1);
    expect(r.finalDecisions).toHaveLength(1);
    expect(r.receipts.map((x) => x.receipt_version)).toEqual([1]);
  });

  it("a second final evaluation with the same verdict and evidence is not an amendment", async () => {
    const r = await replayInParallel("live-2026-10-19-b");
    const p = r.w.pipeline();
    await p.evaluate(r.exec.execution_id, "DUPLICATE_FINALIZATION", "FINAL"); // e.g. a redelivered request
    await r.w.drainInParallel();
    const store = r.w.pipeline().store;
    expect((await store.listDecisions(r.exec.execution_id)).filter((d) => d.final)).toHaveLength(1);
    expect(await store.listReceipts()).toHaveLength(1);
  });

  it("a finalization lease that has expired can be taken again (the holder crashed)", async () => {
    const w = world();
    const store = w.pipeline().store;
    const t0 = Date.parse("2026-10-21T09:00:00Z");
    expect(await store.claimFinalization("EXEC-X", t0)).toBe(true);
    expect(await store.claimFinalization("EXEC-X", t0 + 1_000)).toBe(false);
    expect(await store.claimFinalization("EXEC-X", t0 + 61_000)).toBe(true);
  });
});
