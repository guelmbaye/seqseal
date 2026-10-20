import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockEvidenceInterpreter } from "@seqseal/evidence-model";
import type { DomainEvent } from "@seqseal/contracts";
import { InMemoryBus, loadPipelineConfig, SeqSealPipeline } from "@seqseal/pipeline";
import { buildReplayDeliveries, ReplayScenario } from "@seqseal/ring-adapter";
import { bedrockEnabled, domainEventFromSqsBody, DynamoDocDatabase, emitMetrics, EventBridgeSink, isRetryableAwsError } from "../src";
import { FakeDynamo } from "./fake-dynamo";

const root = join(__dirname, "..", "..", "..");
const names = { executions: "ex", evidence: "ev", config: "cfg", idempotency: "idem" };

async function runOnDynamo(file: string, fake = new FakeDynamo()) {
  const bus = new InMemoryBus();
  const pipeline = new SeqSealPipeline({ db: new DynamoDocDatabase(names, fake), config: loadPipelineConfig(), interpreter: new MockEvidenceInterpreter(), sink: bus });
  const scenario = ReplayScenario.parse(JSON.parse(readFileSync(join(root, "fixtures/scenarios", file), "utf8")));
  const replay = { run_id: `dyn-${file}`, scenario_id: scenario.scenario_id };
  for (const d of buildReplayDeliveries(scenario, { runId: replay.run_id })) {
    await pipeline.ingestWebhook({ rawBody: d.rawBody, profile: "FIXTURE_REPLAY", replay });
    // duplicate delivery must be absorbed by the conditional idempotency write
    await pipeline.ingestWebhook({ rawBody: d.rawBody, profile: "FIXTURE_REPLAY", replay });
    while (bus.queue.length) await pipeline.handle(bus.queue.shift()!);
  }
  const [exec] = await pipeline.store.listExecutions();
  return { exec: exec!, bus, pipeline, fake };
}

describe("DynamoDB adapter + real pipeline", () => {
  it("Winning Moment on the DynamoDB code path: A → RELEASED, B → HELD, one business event each", async () => {
    const a = await runOnDynamo("correct-sequence.json");
    const b = await runOnDynamo("wrong-sequence.json");
    expect([a.exec.latest_verdict, a.exec.workflow_status]).toEqual(["SEALED", "RELEASED"]);
    expect([b.exec.latest_verdict, b.exec.workflow_status]).toEqual(["DEVIATED", "HELD"]);
    expect(a.bus.published.filter((e) => e.name === "WorkflowReleased")).toHaveLength(1);
    expect(b.bus.published.filter((e) => e.name === "WorkflowHeld")).toHaveLength(1);
    expect((await a.pipeline.store.listExecutionReceipts(a.exec.execution_id))[0]?.operational.applied).toBe(true);
  });

  it("re-handling a decision on DynamoDB is idempotent (conditional writes)", async () => {
    const b = await runOnDynamo("wrong-sequence.json");
    const decisions = b.bus.published.filter((e) => e.name === "OperationalDecisionCreated");
    let business = 0;
    for (const d of decisions) business += (await b.pipeline.handle(d)).filter((e) => e.name.startsWith("Workflow")).length;
    expect(business).toBe(0);
  });
});

describe("EventBridge", () => {
  const evt = (i: number): DomainEvent => ({ event_id: `E${i}`, event_type: "seqseal.operation.workflow_held", name: "WorkflowHeld", event_version: "1.0", occurred_at: "2026-10-18T14:06:00.000Z", correlation_id: "COR-1", payload: {} });

  it("publishes in batches of 10 with Source=seqseal and DetailType=event_type", async () => {
    const send = vi.fn(async () => ({ FailedEntryCount: 0, Entries: [] }));
    await new EventBridgeSink("bus", { send } as never).publish(Array.from({ length: 23 }, (_, i) => evt(i)));
    expect(send).toHaveBeenCalledTimes(3);
    const first = (send.mock.calls[0] as unknown as [{ input: { Entries: Array<{ Source: string; DetailType: string; EventBusName: string }> } }])[0].input.Entries[0]!;
    expect(first).toMatchObject({ Source: "seqseal", DetailType: "seqseal.operation.workflow_held", EventBusName: "bus" });
  });

  it("surfaces partial failures as retryable errors", async () => {
    const send = vi.fn(async () => ({ FailedEntryCount: 1, Entries: [{ ErrorCode: "ThrottlingException" }] }));
    await expect(new EventBridgeSink("bus", { send } as never).publish([evt(1)])).rejects.toSatisfy(isRetryableAwsError);
  });

  it("unwraps EventBridge → SQS envelopes and validates the domain event", () => {
    const body = JSON.stringify({ version: "0", source: "seqseal", "detail-type": "seqseal.operation.workflow_held", detail: evt(1) });
    expect(domainEventFromSqsBody(body).name).toBe("WorkflowHeld");
    expect(() => domainEventFromSqsBody(JSON.stringify({ detail: { foo: 1 } }))).toThrow();
  });
});

describe("observability", () => {
  it("emits CloudWatch EMF metrics for business events", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    emitMetrics([{ event_id: "1", event_type: "x", name: "WorkflowHeld", event_version: "1.0", occurred_at: "2026-10-18T14:06:00.000Z", correlation_id: "C", execution_id: "EXEC-1", payload: {} }], "demo");
    const line = JSON.parse(String(log.mock.calls[0]![0]));
    log.mockRestore();
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe("SEQSEAL");
    expect(line.WorkflowHeld).toBe(1);
    expect(line.Environment).toBe("demo");
  });

  it("classifies retryable infrastructure errors", () => {
    expect(isRetryableAwsError({ name: "ProvisionedThroughputExceededException" })).toBe(true);
    expect(isRetryableAwsError({ name: "ValidationException", $metadata: { httpStatusCode: 400 } })).toBe(false);
  });
});

describe("Bedrock switch (Master Brief §33)", () => {
  it("BEDROCK_DISABLED=true always wins; Bedrock also needs an explicit flag and a model", () => {
    expect(bedrockEnabled({ ENABLE_BEDROCK_EVIDENCE: "true", BEDROCK_EVIDENCE_MODEL_ID: "m", BEDROCK_DISABLED: "true" })).toBe(false);
    expect(bedrockEnabled({ ENABLE_BEDROCK_EVIDENCE: "true", BEDROCK_EVIDENCE_MODEL_ID: "" })).toBe(false);
    expect(bedrockEnabled({ ENABLE_BEDROCK_EVIDENCE: "false", BEDROCK_EVIDENCE_MODEL_ID: "m" })).toBe(false);
    expect(bedrockEnabled({ ENABLE_BEDROCK_EVIDENCE: "true", BEDROCK_EVIDENCE_MODEL_ID: "m" })).toBe(true);
  });
});
