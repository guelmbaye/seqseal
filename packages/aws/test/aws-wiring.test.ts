/**
 * What AWS will actually do, checked before `terraform apply`.
 *
 * The Terraform files are read as written: EventBridge routes (detail-type → queue), queue
 * consumers, and the IAM authority table. The real pipeline then runs every demo flow with
 * each event delivered exactly as AWS would deliver it: to the queue its rule targets, consumed
 * by that queue's function, dropped if the function does not accept it. Every DynamoDB action,
 * S3 object and PutEvents is attributed to the function that performs it and checked against
 * that function's IAM grants. A missing grant here is an AccessDenied in production.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { EVENT_TYPES, type DomainEvent } from "@seqseal/contracts";
import { MockEvidenceInterpreter } from "@seqseal/evidence-model";
import { handleReadApi, InMemoryBus, loadPipelineConfig, ReadModel, SeqSealPipeline, type ArtifactStore } from "@seqseal/pipeline";
import { buildReplayDeliveries, buildRingWebhookEnvelope, computeRingSignature, ReplayScenario } from "@seqseal/ring-adapter";
import { DynamoDocDatabase } from "../src";
import { FakeDynamo } from "./fake-dynamo";

const root = join(__dirname, "..", "..", "..");
const tf = (f: string) => readFileSync(join(root, "infrastructure/terraform", f), "utf8");
const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);

/* ───────────── Terraform, as written ───────────── */

type Grant = { dynamodb: Array<{ tables: string[]; actions: string[] }>; secrets: string[]; s3: Array<{ actions: string[]; prefix: string }>; putEvents: boolean };

function iamAuthority(): Record<string, Grant> {
  const src = tf("modules/iam/main.tf");
  const locals: Record<string, string[]> = {};
  for (const m of src.matchAll(/^\s+(ddb_\w+|all_table_keys)\s*=\s*\[([^\]]*)\]/gm)) locals[m[1]!] = quoted(m[2]!);
  const block = src.slice(src.indexOf("authority = {"));
  const out: Record<string, Grant> = {};
  for (const m of block.matchAll(/^ {4}"([a-z-]+)" = \{([\s\S]*?)^ {4}\}/gm)) {
    const body = m[2]!;
    out[m[1]!] = {
      dynamodb: [...body.matchAll(/tables\s*=\s*(local\.all_table_keys|\[[^\]]*\])\s*,\s*actions\s*=\s*local\.(\w+)/g)].map((d) => ({
        tables: d[1]!.startsWith("local.") ? locals.all_table_keys! : quoted(d[1]!),
        actions: locals[d[2]!]!,
      })),
      secrets: quoted(/secrets\s*=\s*\[([^\]]*)\]/.exec(body)?.[1] ?? ""),
      s3: [...body.matchAll(/\{\s*actions\s*=\s*\[([^\]]*)\]\s*,\s*prefix\s*=\s*"([^"]+)"\s*\}/g)].map((x) => ({ actions: quoted(x[1]!), prefix: x[2]! })),
      putEvents: /put_events\s*=\s*true/.test(body),
    };
  }
  return out;
}

function eventRoutes(): { routes: Record<string, string[]>; consumer: Record<string, string> } {
  const main = tf("main.tf");
  const block = main.slice(main.indexOf("event_routes = {"), main.indexOf("api_routes = {"));
  const routes = Object.fromEntries([...block.matchAll(/"([a-z-]+-q)"\s*=\s*\[([\s\S]*?)\]/g)].map((m) => [m[1]!, quoted(m[2]!)]));
  const consumer = Object.fromEntries([...main.matchAll(/"([a-z-]+-q)"\s*=\s*\{\s*consumer\s*=\s*"([a-z-]+)"/g)].map((m) => [m[1]!, m[2]!]));
  return { routes, consumer };
}

/** The event names each SQS-driven function accepts (`sqsStage(service, [...])` in its handler). */
function stageAccepts(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const svc of readdirSync(join(root, "services"))) {
    let src = "";
    try {
      src = readFileSync(join(root, "services", svc, "src", "index.ts"), "utf8");
    } catch {
      continue;
    }
    const m = /sqsStage\(\s*"([a-z-]+)",\s*\[([\s\S]*?)\]\s*\)/.exec(src);
    if (m) out[m[1]!] = quoted(m[2]!);
  }
  return out;
}

const iam = iamAuthority();
const { routes, consumer } = eventRoutes();
const accepts = stageAccepts();
const nameOfType = Object.fromEntries(Object.entries(EVENT_TYPES).map(([name, type]) => [type, name]));
const typeOfName = EVENT_TYPES as Record<string, string>;

describe("Terraform wiring matches the handlers", () => {
  it("parses the files it checks", () => {
    expect(Object.keys(iam).length).toBe(13);
    expect(Object.keys(routes).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(accepts).sort()).toEqual(["evidence-resolver", "media-interpreter", "observation-normalizer", "operational-gate", "policy-evaluator", "receipt-generator", "sequence-evaluator"]);
  });

  it("every routed event type is accepted by the function consuming that queue", () => {
    for (const [queue, types] of Object.entries(routes)) {
      for (const t of types) expect(accepts[consumer[queue]!], `${t} routed to ${queue} (${consumer[queue]})`).toContain(nameOfType[t]);
    }
  });

  it("every event a function accepts is routed to one of its queues", () => {
    for (const [fn, names] of Object.entries(accepts)) {
      const mine = Object.entries(routes).filter(([q]) => consumer[q] === fn).flatMap(([, t]) => t);
      for (const n of names) expect(mine, `${fn} accepts ${n}`).toContain(typeOfName[n]);
    }
  });

  it("each secret is granted to exactly the functions that read it", () => {
    const src = (svc: string) => readFileSync(join(root, "services", svc, "src", "index.ts"), "utf8");
    for (const fn of Object.keys(iam)) {
      const code = src(fn);
      const needs = new Set<string>();
      if (/ringSigningSecret:\s*true/.test(code)) needs.add("ring_webhook_signing_secret");
      if (/requireDemoToken\(/.test(code)) needs.add("demo_token");
      if (/RING_API_TOKEN_SECRET_ARN/.test(code)) needs.add("ring_api_token");
      // With Bedrock enabled, the media interpreter fetches a fresh Ring snapshot (packages/aws/src/lambda.ts).
      if (fn === "media-interpreter") needs.add("ring_api_token");
      expect(new Set(iam[fn]!.secrets), fn).toEqual(needs);
    }
  });
});

/* ───────────── The real pipeline, delivered the AWS way ───────────── */

const tableNames = { executions: "t-executions", evidence: "t-evidence", config: "t-config", idempotency: "t-idempotency" };
const tableKey = Object.fromEntries(Object.entries(tableNames).map(([k, v]) => [v, k]));

/** FakeDynamo that reports every command it serves (table, action). */
class RecordingDynamo extends FakeDynamo {
  constructor(private readonly record: (table: string, action: string) => void) {
    super();
  }
  override async send(cmd: unknown) {
    const input = (cmd as { input: { TableName: string } }).input;
    const action =
      cmd instanceof GetCommand ? "GetItem" : cmd instanceof PutCommand ? "PutItem" : cmd instanceof UpdateCommand ? "UpdateItem" : cmd instanceof QueryCommand ? "Query" : cmd instanceof DeleteCommand ? "DeleteItem" : "?";
    this.record(tableKey[input.TableName] ?? input.TableName, action);
    return super.send(cmd);
  }
}

class World {
  fn = "";
  readonly used = new Set<string>(); // "function|resource|action"
  readonly dropped: string[] = [];
  readonly dynamo: FakeDynamo;
  readonly bus = new InMemoryBus();
  readonly config = loadPipelineConfig();
  constructor() {
    this.dynamo = new RecordingDynamo((table, action) => this.used.add(`${this.fn}|dynamodb:${table}|dynamodb:${action}`));
  }
  /** A fresh pipeline per invocation, as each Lambda builds its own runtime. */
  pipeline(opts: { signingSecret?: string } = {}) {
    const artifacts: ArtifactStore = {
      putJson: async (key: string) => {
        this.used.add(`${this.fn}|s3:${key}|s3:PutObject`);
      },
      getJson: async <T>(key: string): Promise<T | undefined> => {
        this.used.add(`${this.fn}|s3:${key}|s3:GetObject`);
        return undefined;
      },
    };
    const sink = {
      publish: async (events: DomainEvent[]) => {
        if (events.length) this.used.add(`${this.fn}|events|events:PutEvents`);
        await this.bus.publish(events);
      },
    };
    return new SeqSealPipeline({
      db: new DynamoDocDatabase(tableNames, this.dynamo),
      config: this.config,
      interpreter: new MockEvidenceInterpreter(),
      sink,
      artifacts,
      ...(opts.signingSecret ? { options: { ringSigningSecret: opts.signingSecret } } : {}),
    });
  }
  as<T>(fn: string, work: (p: SeqSealPipeline) => Promise<T>, opts: { signingSecret?: string } = {}): Promise<T> {
    this.fn = fn;
    return work(this.pipeline(opts));
  }
  /** EventBridge → rule → queue → consumer, until nothing is left in flight. */
  async drain() {
    while (this.bus.queue.length) {
      const e = this.bus.queue.shift()!;
      for (const [queue, types] of Object.entries(routes)) {
        if (!types.includes(e.event_type)) continue;
        const fn = consumer[queue]!;
        if (!accepts[fn]?.includes(e.name)) {
          this.dropped.push(`${e.name} → ${fn}`);
          continue;
        }
        await this.as(fn, (p) => p.handle(e));
      }
    }
  }
}

const scenario = (name: string) => ReplayScenario.parse(JSON.parse(readFileSync(join(root, "fixtures/scenarios", `${name}.json`), "utf8")));
const session = (name: string) =>
  readFileSync(join(root, "fixtures/ring/captures", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);

/** demo-orchestrator `run`: replays a test fixture through the ingress, then finalizes if asked. */
async function demoRun(w: World, name: string) {
  const sc = scenario(name);
  const replay = { run_id: `run-${name}`, scenario_id: sc.scenario_id, label: sc.label };
  for (const d of buildReplayDeliveries(sc, { runId: replay.run_id }).filter((x) => x.phase === "main")) {
    await w.as("demo-orchestrator", (p) => p.ingestWebhook({ rawBody: d.rawBody, profile: sc.source_profile, replay }));
    await w.drain();
  }
  if (sc.finalize_at_end) {
    const lane = w.pipeline().laneFor(replay);
    const id = await w.pipeline().store.getActiveExecutionId(lane);
    if (id) await w.as("demo-orchestrator", (p) => p.finalize(id, "DEADLINE_REACHED"));
    await w.drain();
  }
}

describe("every demo flow, run with the IAM grants AWS will enforce", () => {
  it("needs no permission the Terraform does not grant", async () => {
    const w = new World();

    // Live and Ring-derived Playground captures (ring-spike.ts run --post <api>, pnpm replay --remote).
    for (const c of session("live-2026-10-19-a")) {
      await w.as("ring-playground-adapter", (p) => p.ingestPlaygroundCapture(c));
      await w.drain();
    }
    const replay = { run_id: "rdr-test", scenario_id: "ring-derived:remote", label: "Ring-derived replay" };
    for (const c of session("live-2026-10-19-b")) {
      await w.as("ring-playground-adapter", (p) => p.ingestPlaygroundCapture(c, replay, "RING_DERIVED_REPLAY"));
      await w.drain();
    }

    // Demo controls: the Winning Moment, ambiguous evidence, missing evidence (finalized by the orchestrator).
    for (const name of ["correct-sequence", "wrong-sequence", "ambiguous-evidence", "missing-evidence"]) await demoRun(w, name);

    // A supervisor confirms the ambiguous evidence (review-api).
    const all = await w.pipeline().store.listExecutions(50);
    const ambiguous = all.find((e) => e.latest_verdict === "UNCERTAIN")!;
    const rm = new ReadModel(w.pipeline().store, w.config, { backend: "test", interpreter: "mock" });
    const detail = await rm.executionDetail(ambiguous.execution_id);
    const candidate = detail!.candidates.find((c) => c.status === "UNCERTAIN")!;
    await w.as("review-api", (p) => p.review({ candidate_id: candidate.candidate_id, action: "CONFIRM", reviewer_ref: "operator" }));
    await w.drain();

    // A signed Ring webhook opens a delivery (ring-ingest); the sweeper later finalizes it.
    const body = JSON.stringify(buildRingWebhookEnvelope({ request_id: "req-w1", device_id: "ring-device-entry", event_type: "motion_detected", sub_type: "vehicle", occurred_at_ms: Date.parse("2026-10-20T09:00:00Z") }));
    const ingest = await w.as("ring-ingest", (p) => p.ingestWebhook({ rawBody: body, headers: { "x-signature": computeRingSignature(body, "whsec") }, profile: "RING_WEBHOOK" }), { signingSecret: "whsec" });
    expect(ingest.status).toBe(202);
    await w.drain();
    for (const e of await w.pipeline().store.listExecutions(50)) {
      if (e.status === "ACTIVE") await w.as("execution-sweeper", (p) => p.finalize(e.execution_id, "HORIZON_REACHED"));
    }
    await w.drain();

    // The web console reads everything (read-api), including a receipt replay.
    w.fn = "read-api";
    const readRm = new ReadModel(w.pipeline().store, w.config, { backend: "test", interpreter: "mock" });
    const receipts = (await handleReadApi(readRm, w.pipeline().store, w.config, "GET", "/api/receipts", {})).body as Array<{ receipt_id: string }>;
    const execs = (await handleReadApi(readRm, w.pipeline().store, w.config, "GET", "/api/executions", {})).body as Array<{ execution_id: string }>;
    for (const path of ["/api/status", "/api/hero", "/api/protocol", "/api/policy", "/api/events", "/api/observations", `/api/executions/${execs[0]!.execution_id}`, `/api/receipts/${receipts[0]!.receipt_id}`, `/api/receipts/${receipts[0]!.receipt_id}/replay`]) {
      expect((await handleReadApi(readRm, w.pipeline().store, w.config, "GET", path, {})).status, path).toBe(200);
    }

    // The flows really ran: live A released, B held, the ambiguous delivery released after review.
    const final = await w.pipeline().store.listExecutions(50);
    expect(final.filter((e) => e.workflow_status === "RELEASED").length).toBeGreaterThanOrEqual(3);
    expect(final.filter((e) => e.workflow_status === "HELD").length).toBeGreaterThanOrEqual(2);

    // Every permission used is granted to the function that used it.
    const missing: string[] = [];
    for (const u of w.used) {
      const [fn, resource, action] = u.split("|") as [string, string, string];
      const g = iam[fn];
      if (!g) {
        missing.push(`${u} (no IAM entry)`);
        continue;
      }
      const ok = resource.startsWith("dynamodb:")
        ? g.dynamodb.some((d) => d.tables.includes(resource.slice(9)) && d.actions.includes(action))
        : resource.startsWith("s3:")
          ? g.s3.some((s) => s.actions.includes(action) && resource.slice(3).startsWith(s.prefix.replace(/\*$/, "")))
          : g.putEvents;
      if (!ok) missing.push(u);
    }
    expect(missing).toEqual([]);
    expect(w.dropped).toEqual([]);
  });
});
