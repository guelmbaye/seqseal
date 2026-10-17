import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { MockEvidenceInterpreter } from "@seqseal/evidence-model";
import type { DomainEvent } from "@seqseal/contracts";
import { InMemoryBus, loadPipelineConfig, SeqSealPipeline } from "@seqseal/pipeline";
import { buildReplayDeliveries, ReplayScenario } from "@seqseal/ring-adapter";
import { bedrockEnabled, domainEventFromSqsBody, DynamoDocDatabase, emitMetrics, EventBridgeSink, isRetryableAwsError } from "../src";

/**
 * Minimal DynamoDB emulator for the exact expression grammar DynamoDocDatabase emits.
 * Lets the REAL pipeline run on the REAL DynamoDB adapter code, so condition-expression
 * translation (idempotency, lane locks, optimistic concurrency) is verified end to end.
 */
class FakeDynamo {
  tables = new Map<string, Map<string, Record<string, unknown>>>();
  calls: string[] = [];
  private t(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }
  private holds(item: Record<string, unknown> | undefined, expr: string | undefined, names: Record<string, string> = {}, values: Record<string, unknown> = {}) {
    if (!expr) return true;
    return expr.split(" OR ").some((atom) => {
      const a = atom.trim();
      const ne = /^attribute_not_exists\((#?\w+)\)$/.exec(a);
      if (ne) {
        const attr = ne[1]!.startsWith("#") ? names[ne[1]!]! : ne[1]!;
        return item === undefined || item[attr] === undefined;
      }
      const cmp = /^(#\w+) (=|<>|<) (:\w+)$/.exec(a);
      if (!cmp || !item) return false;
      const v = item[names[cmp[1]!]!];
      const w = values[cmp[3]!];
      return cmp[2] === "=" ? v === w : cmp[2] === "<>" ? v !== w : (v as number) < (w as number);
    });
  }
  async send(cmd: unknown) {
    const input = (cmd as { input: Record<string, never> }).input as Record<string, unknown>;
    const table = this.t(String(input.TableName));
    const key = (k: { pk: string; sk: string }) => `${k.pk}\u0000${k.sk}`;
    const fail = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
    if (cmd instanceof GetCommand) {
      this.calls.push("Get");
      const it = table.get(key(input.Key as { pk: string; sk: string }));
      return { Item: it ? structuredClone(it) : undefined };
    }
    if (cmd instanceof PutCommand) {
      this.calls.push("Put");
      const item = JSON.parse(JSON.stringify(input.Item)) as { pk: string; sk: string };
      if (!this.holds(table.get(key(item)), input.ConditionExpression as string, input.ExpressionAttributeNames as Record<string, string>, input.ExpressionAttributeValues as Record<string, unknown>)) throw fail();
      table.set(key(item), item);
      return {};
    }
    if (cmd instanceof DeleteCommand) {
      const k = key(input.Key as { pk: string; sk: string });
      if (!this.holds(table.get(k), input.ConditionExpression as string, input.ExpressionAttributeNames as Record<string, string>, input.ExpressionAttributeValues as Record<string, unknown>)) throw fail();
      table.delete(k);
      return {};
    }
    if (cmd instanceof UpdateCommand) {
      const k = key(input.Key as { pk: string; sk: string });
      const attr = (input.ExpressionAttributeNames as Record<string, string>)["#a"]!;
      const cur = table.get(k) ?? { ...(input.Key as object) };
      const next = { ...cur, [attr]: ((cur as Record<string, number>)[attr] ?? 0) + (input.ExpressionAttributeValues as Record<string, number>)[":by"]! };
      table.set(k, next);
      return { Attributes: { [attr]: next[attr] } };
    }
    if (cmd instanceof QueryCommand) {
      const v = input.ExpressionAttributeValues as Record<string, string>;
      let rows = [...table.values()].filter((r) => r.pk === v[":pk"] && (!v[":p"] || String(r.sk).startsWith(v[":p"])));
      rows.sort((a, b) => (String(a.sk) < String(b.sk) ? -1 : 1));
      if (input.ScanIndexForward === false) rows = rows.reverse();
      if (input.Limit) rows = rows.slice(0, input.Limit as number);
      return { Items: rows.map((r) => structuredClone(r)) };
    }
    throw new Error(`unsupported command ${String(cmd)}`);
  }
}

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
