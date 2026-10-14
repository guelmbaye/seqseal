/**
 * demo-orchestrator — POST /api/demo/{run|winning-moment|finalize|reset}
 *
 * Launches source-level fixture scenarios through the normal ingestion path (labelled
 * FIXTURE_REPLAY). It may publish source inputs; it can NEVER set a verdict, publish
 * WorkflowHeld/WorkflowReleased or write workflow state (Doc 06 §105).
 */
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { awsRuntime, json, rawBody, requireDemoToken, type AwsRuntime } from "@seqseal/aws";
import { loadScenario } from "@seqseal/pipeline";
import { buildReplayDeliveries, computeRingSignature, ReplayScenario } from "@seqseal/ring-adapter";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(rt: AwsRuntime, scenarioId: string, paceMs: number) {
  const scenario = ReplayScenario.parse(loadScenario(scenarioId));
  const runId = `run-${randomUUID().slice(0, 8)}`;
  const replay = { run_id: runId, scenario_id: scenario.scenario_id, label: scenario.label };
  const deliveries = buildReplayDeliveries(scenario, { runId, accountId: "fixture-account" });
  const results = [];
  for (const d of deliveries.filter((x) => x.phase === "main")) {
    const headers: Record<string, string> = {};
    if (scenario.source_profile === "RING_WEBHOOK" || scenario.source_profile === "RING_STAGING") {
      headers["x-signature"] = computeRingSignature(d.rawBody, rt.pipeline.options.ringSigningSecret ?? "");
    }
    results.push(await rt.pipeline.ingestWebhook({ rawBody: d.rawBody, headers, profile: scenario.source_profile, replay }));
    if (paceMs) await sleep(paceMs);
  }
  let finalized: string | undefined;
  if (scenario.finalize_at_end) {
    // Processing is asynchronous: wait until the lane's execution stops changing, then close it.
    const lane = rt.pipeline.laneFor(replay);
    let last = "";
    for (let i = 0; i < 20; i++) {
      await sleep(600);
      const id = await rt.pipeline.store.getActiveExecutionId(lane);
      const e = id ? await rt.pipeline.store.getExecution(id) : undefined;
      const sig = e ? `${e.evidence_ids.length}/${e.latest_evaluation_seq}` : "";
      if (e && sig === last) {
        await rt.pipeline.finalize(e.execution_id, "DEADLINE_REACHED");
        finalized = e.execution_id;
        break;
      }
      last = sig;
    }
  }
  return { run_id: runId, scenario_id: scenario.scenario_id, label: scenario.label, deliveries: results.map((r) => r.outcome), ...(finalized ? { finalized } : {}) };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const denied = await requireDemoToken(event);
  if (denied) return denied;
  const rt = await awsRuntime("demo-orchestrator");
  const action = event.rawPath.split("/").pop();
  const body = JSON.parse(rawBody(event) || "{}") as { scenario?: string; pace_ms?: number; execution_id?: string };
  const pace = Math.min(Math.max(Number(body.pace_ms ?? 900), 0), 2500);

  switch (action) {
    case "run":
      if (!body.scenario) return json(400, { error: "scenario required" });
      return json(202, await run(rt, body.scenario, pace));
    case "winning-moment": {
      const a = await run(rt, "correct-sequence", pace);
      const b = await run(rt, "wrong-sequence", pace);
      return json(202, { runs: [a, b] });
    }
    case "finalize": {
      if (!body.execution_id) return json(400, { error: "execution_id required" });
      await rt.pipeline.finalize(body.execution_id, "OPERATOR_CLOSE");
      return json(202, { finalized: body.execution_id });
    }
    case "reset": {
      // Close active demo executions (operator close). Receipts and history are preserved.
      const closed: string[] = [];
      for (const e of await rt.pipeline.store.listExecutions(200)) {
        if (e.status === "ACTIVE" && e.replay) {
          await rt.pipeline.finalize(e.execution_id, "DEMO_RESET");
          closed.push(e.execution_id);
        }
      }
      return json(200, { closed });
    }
    default:
      return json(404, { error: "unknown demo action" });
  }
}
