/**
 * Headless replay of fixture scenarios through the full pipeline.
 *
 *   pnpm replay --scenario winning-moment          # A then B, in-process
 *   pnpm replay --scenario ambiguous-evidence
 *   pnpm replay --scenario wrong-sequence --remote https://<api> --token <demo-token>
 *
 * Replay never bypasses domain services and is always labelled FIXTURE_REPLAY.
 */
import { LocalRuntime, loadScenario } from "@seqseal/pipeline";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const scenarioId = arg("scenario") ?? "winning-moment";
const remote = arg("remote");
const LABEL: Record<string, string> = { arrival: "ARRIVAL", staging: "STAGING", storage: "STORAGE", departure: "DEPARTURE", clear: "CLEAR" };

if (remote) {
  const token = arg("token") ?? process.env.SEQSEAL_DEMO_TOKEN ?? "";
  const path = scenarioId === "winning-moment" ? "/api/demo/winning-moment" : "/api/demo/run";
  const res = await fetch(`${remote.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-seqseal-demo-token": token },
    body: JSON.stringify({ scenario: scenarioId }),
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
  process.exit(res.ok ? 0 : 1);
}

const rt = new LocalRuntime();
const ids = scenarioId === "winning-moment" ? ["correct-sequence", "wrong-sequence"] : [scenarioId];
for (const id of ids) {
  const run = await rt.runScenario(loadScenario(id));
  for (const execId of run.execution_ids) {
    const e = (await rt.store.getExecution(execId))!;
    const ev = (await rt.store.getEvaluation(e.latest_evaluation_id!))!;
    const [receipt] = (await rt.store.listExecutionReceipts(execId)).slice(-1);
    console.log(`\n${run.scenario_id}  ·  ${execId}  ·  source: FIXTURE_REPLAY (Ring-shaped webhooks)`);
    console.log(`  EXPECTED  ${ev.expected_sequence.map((s) => LABEL[s] ?? s).join(" → ")}`);
    console.log(`  OBSERVED  ${ev.observed_sequence.map((s) => `${LABEL[s.state] ?? s.state} ${s.occurred_at.slice(11, 16)}`).join(" → ")}`);
    for (const r of ev.rule_results.filter((x) => x.status !== "PASS")) console.log(`  ${r.rule_id.padEnd(9)} ${r.status.padEnd(14)} ${r.explanation}`);
    console.log(`  VERDICT   ${ev.verdict}   →   ACTION ${e.latest_action ?? "—"}   (workflow ${e.workflow_status})`);
    console.log(`  WHY       ${ev.explanation}`);
    if (receipt) console.log(`  RECEIPT   ${receipt.receipt_id}  ${receipt.receipt_hash.slice(0, 23)}…`);
  }
}
if (ids.length === 2) console.log("\nSame observations. Different sequence. Different operational action.\n");
