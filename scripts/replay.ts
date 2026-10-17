/**
 * Headless replay through the full pipeline.
 *
 *   pnpm replay --scenario winning-moment          # fixtures A then B, in-process (TEST FIXTURE)
 *   pnpm replay --scenario ambiguous-evidence
 *   pnpm replay --scenario wrong-sequence --remote https://<api> --token <demo-token>
 *
 *   pnpm replay --captures fixtures/ring/captures/<session>.jsonl
 *   pnpm replay --captures fixtures/ring/captures/<session>.jsonl --remote https://<api> --token <demo-token>
 *       Ring-derived replay: Playground captures saved by `scripts/ring-spike.ts capture` are
 *       replayed through the normal pipeline and labelled RING_DERIVED_REPLAY (never "live").
 *
 * Replay never bypasses domain services and never sets a verdict or an action.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { LocalRuntime, loadScenario, type ScenarioRunResult } from "@seqseal/pipeline";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const scenarioId = arg("scenario") ?? "winning-moment";
const capturesFile = arg("captures");
const remote = arg("remote")?.replace(/\/$/, "");
const token = arg("token") ?? process.env.SEQSEAL_DEMO_TOKEN ?? "";
const LABEL: Record<string, string> = { arrival: "ARRIVAL", staging: "STAGING", storage: "STORAGE", departure: "DEPARTURE", clear: "CLEAR" };

const captures = capturesFile
  ? readFileSync(capturesFile, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown)
  : [];

if (remote) {
  if (capturesFile) {
    const run = `rdr-${Date.now().toString(36)}`;
    for (const c of captures) {
      const res = await fetch(`${remote}/integrations/ring/playground/capture`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-seqseal-demo-token": token,
          "x-seqseal-source-profile": "RING_DERIVED_REPLAY",
          "x-seqseal-replay-run": run,
        },
        body: JSON.stringify(c),
      });
      console.log(res.status, await res.text());
      if (!res.ok) process.exit(1);
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log(`\nRing-derived replay ${run} sent: ${captures.length} captures. Check ${remote}/api/executions`);
    process.exit(0);
  }
  const path = scenarioId === "winning-moment" ? "/api/demo/winning-moment" : "/api/demo/run";
  const res = await fetch(`${remote}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-seqseal-demo-token": token },
    body: JSON.stringify({ scenario: scenarioId }),
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
  process.exit(res.ok ? 0 : 1);
}

const rt = new LocalRuntime();
const runs: Array<{ run: ScenarioRunResult; source: string }> = [];
if (capturesFile) {
  runs.push({ run: await rt.runCaptures(captures, { session: basename(capturesFile, ".jsonl") }), source: "RING_DERIVED_REPLAY (saved Ring Playground captures)" });
} else {
  const ids = scenarioId === "winning-moment" ? ["correct-sequence", "wrong-sequence"] : [scenarioId];
  for (const id of ids) runs.push({ run: await rt.runScenario(loadScenario(id)), source: "FIXTURE_REPLAY (test fixture, Ring-shaped webhooks)" });
}

for (const { run, source } of runs) {
  for (const execId of run.execution_ids) {
    const e = (await rt.store.getExecution(execId))!;
    const ev = (await rt.store.getEvaluation(e.latest_evaluation_id!))!;
    const [receipt] = (await rt.store.listExecutionReceipts(execId)).slice(-1);
    console.log(`\n${run.scenario_id}  ·  ${execId}  ·  source: ${source}`);
    console.log(`  EXPECTED  ${ev.expected_sequence.map((s) => LABEL[s] ?? s).join(" → ")}`);
    console.log(`  OBSERVED  ${ev.observed_sequence.map((s) => `${LABEL[s.state] ?? s.state} ${s.occurred_at.slice(11, 16)}`).join(" → ")}`);
    for (const r of ev.rule_results.filter((x) => x.status !== "PASS")) console.log(`  ${r.rule_id.padEnd(9)} ${r.status.padEnd(14)} ${r.explanation}`);
    console.log(`  VERDICT   ${ev.verdict}   →   ACTION ${e.latest_action ?? "—"}   (workflow ${e.workflow_status})`);
    if (receipt) {
      console.log(`  WHY       ${receipt.explanation_chain.map((l) => `${l.connector ? `${l.connector} ` : ""}${l.text}`).join("\n            ")}`);
      console.log(`  RECEIPT   ${receipt.receipt_id}  ${receipt.receipt_hash.slice(0, 23)}…`);
    } else {
      console.log(`  WHY       ${ev.explanation}`);
    }
  }
}
if (!capturesFile && runs.length === 2) console.log("\nEvery box is checked. Order still matters.\nSame observations. Different sequence. Different operational action.\n");
