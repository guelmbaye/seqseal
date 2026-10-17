/**
 * SEQSEAL benchmark harness (Doc 07). Runs every curated scenario end to end through the
 * real pipeline (fixture replay → normalization → evidence → engine → policy → gate →
 * receipt) and measures verification safety and operational safety separately.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateActionPolicy } from "@seqseal/action-policy-core";
import { evaluateExecution } from "@seqseal/engine-core";
import type { DomainEvent, Evidence, WorkflowStatus } from "@seqseal/contracts";
import { LocalRuntime, loadPipelineConfig, replayReceipt, type PipelineConfig } from "@seqseal/pipeline";
import { ReplayScenario } from "@seqseal/ring-adapter";
import { parse as parseYaml } from "yaml";

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(BENCH_DIR, "..");

const STATUS_ACTION: Record<WorkflowStatus, string | null> = {
  PENDING: null,
  WAITING: "WAIT",
  REVIEW_REQUIRED: "REVIEW",
  HELD: "HOLD",
  RELEASED: "RELEASE",
};
const BUSINESS_EVENTS = ["WorkflowReleased", "WorkflowHeld", "WorkflowReviewRequired", "WorkflowAwaitingEvidence"];

export interface ScenarioResult {
  id: string;
  scenario_id: string;
  label: string;
  category: string;
  supported: boolean;
  expected: Record<string, unknown>;
  observed: {
    executions: number;
    verdict: string | null;
    action: string | null;
    workflow_status: string | null;
    primary_rule: string | null;
    receipts: number;
    ever_released: boolean;
    ever_held: boolean;
    final_sealed: boolean;
    business_events: Record<string, number>;
    system_errors: string[];
    evidence_count: number;
  };
  replay: { receipts: number; consistent: number; verdict_consistent: number; action_consistent: number };
  provenance: { evidence: number; traceable: number };
  release_invariant_violations: number;
  duplicate_action_events: number;
  failures: string[];
  passed: boolean;
}

export interface BenchmarkReport {
  benchmark: string;
  generated_at: string;
  commit: string | null;
  protocol: { ref: string; hash: string };
  action_policy: { ref: string; hash: string };
  engine_version: string;
  interpreter: string;
  scenarios: ScenarioResult[];
  policy_checks: Array<{ id: string; file: string; expect: string; observed: string; passed: boolean; errors: string[] }>;
  determinism: { engine_runs: number; engine_consistent: boolean; pipeline_runs: number; pipeline_expected: number; a_sealed_released: number; b_deviated_held: number };
  metrics: {
    scenarios: number;
    passed: number;
    unsupported: number;
    supported: number;
    false_sealed: number;
    false_release: number;
    false_hold: number;
    verdict_checked: number;
    verdict_correct: number;
    action_checked: number;
    action_correct: number;
    receipts: number;
    replay_consistent: number;
    verdict_replay_consistent: number;
    action_replay_consistent: number;
    evidence_items: number;
    evidence_traceable: number;
    release_invariant_violations: number;
    duplicate_action_events: number;
  };
}

function loadManifest() {
  return JSON.parse(readFileSync(join(BENCH_DIR, "manifest.json"), "utf8")) as {
    benchmark: string;
    scenarios: Array<{ id: string; file: string }>;
    policy_checks: Array<{ id: string; file: string; expect: string }>;
  };
}

function countBusiness(events: DomainEvent[], executionId: string): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(BUSINESS_EVENTS.map((n) => [n, 0]));
  for (const e of events) if (e.execution_id === executionId && BUSINESS_EVENTS.includes(e.name)) out[e.name] = (out[e.name] ?? 0) + 1;
  return out;
}

export async function runScenarioBenchmark(id: string, file: string, config: PipelineConfig): Promise<ScenarioResult> {
  const scenario = ReplayScenario.parse(JSON.parse(readFileSync(join(BENCH_DIR, file), "utf8")));
  const rt = new LocalRuntime({ config, options: { ...(scenario.inject_faults ? { faults: scenario.inject_faults } : {}) } });
  const run = await rt.runScenario(scenario, { runId: `bench-${id}` });
  const failures: string[] = [];
  const expected = scenario.expected ?? { supported: false };

  // Post-run checks that exercise idempotency and human review.
  let extraEvents: DomainEvent[] = [];
  const before = rt.bus.published.length;
  // At-least-once delivery: hand the same OperationalDecisionCreated / ActionApplied events to the
  // Operational Gate and the receipt generator again (`redeliver_decisions[:N]`, `redeliver_action_applied[:N]`).
  const times = (name: string) => {
    const c = scenario.checks.find((x) => x === name || x.startsWith(`${name}:`));
    return c ? Number(c.split(":")[1] ?? 1) : 0;
  };
  const redeliver = async (eventName: string, n: number) => {
    for (let i = 0; i < n; i++) {
      for (const e of run.events.filter((x) => x.name === eventName)) await rt.pipeline.handle(e);
      await rt.drain();
    }
  };
  await redeliver("OperationalDecisionCreated", times("redeliver_decisions"));
  await redeliver("ActionApplied", times("redeliver_action_applied"));
  for (const c of scenario.checks.filter((x) => x === "review_confirm" || x === "review_reject")) {
    for (const execId of run.execution_ids) {
      for (const cand of await rt.store.listExecutionCandidates(execId)) {
        if (cand.status === "UNCERTAIN") {
          await rt.review({ candidate_id: cand.candidate_id, action: c === "review_confirm" ? "CONFIRM" : "REJECT", reviewer_ref: "benchmark-reviewer" });
        }
      }
    }
  }
  extraEvents = rt.bus.published.slice(before);
  const allEvents = [...run.events, ...extraEvents];
  const redeliveryBusiness = times("redeliver_decisions") || times("redeliver_action_applied") ? extraEvents.filter((e) => BUSINESS_EVENTS.includes(e.name) || e.name === "ReceiptGenerated").length : 0;

  const execId = run.execution_ids[0];
  const execution = execId ? await rt.store.getExecution(execId) : undefined;
  const evaluations = execId ? await rt.store.listEvaluations(execId) : [];
  const decisions = execId ? await rt.store.listDecisions(execId) : [];
  const { wf } = execId ? await rt.store.getWorkflow(execId) : { wf: undefined };
  const receipts = execId ? await rt.store.listExecutionReceipts(execId) : [];
  const evidence: Evidence[] = execId ? await rt.store.listExecutionEvidence(execId) : [];
  const latest = evaluations.at(-1);
  const business = execId ? countBusiness(allEvents, execId) : {};
  const systemErrors = allEvents.filter((e) => e.name === "SystemError").map((e) => String(e.payload.code));

  // Release invariant over every decision and every applied transition.
  let releaseViolations = 0;
  for (const d of decisions) if (d.action === "RELEASE" && (d.verdict !== "SEALED" || !d.final)) releaseViolations++;
  for (const h of wf?.history ?? []) if (h.to === "RELEASED" && (h.verdict !== "SEALED" || !h.final)) releaseViolations++;

  // Duplicate business events: the same event emitted twice for the same target status.
  let duplicateActions = redeliveryBusiness;
  const transitions = (wf?.history ?? []).filter((h) => h.event_type);
  const seen = new Set<string>();
  for (const t of transitions) {
    const k = `${t.to}#${t.decision_id}`;
    if (seen.has(k)) duplicateActions++;
    seen.add(k);
  }

  // Provenance: every accepted evidence item traces to an observation and a raw source record.
  let traceable = 0;
  for (const e of evidence) {
    const obs = await Promise.all(e.observation_refs.map((o) => rt.store.getObservation(o)));
    const raws = await Promise.all(obs.map((o) => (o ? rt.store.getRawRecord(o.raw_source_ref) : undefined)));
    if (e.source_refs.length && obs.every(Boolean) && raws.every(Boolean)) traceable++;
  }

  // Replay every receipt: verdict replay (protocol + evidence + engine) and action replay (+ policy) separately.
  let consistent = 0;
  let verdictConsistent = 0;
  let actionConsistent = 0;
  for (const r of receipts) {
    const c = await replayReceipt(rt.store, config, r);
    if (c.consistent) consistent++;
    if (c.verdict_match && c.protocol_hash_match && c.evidence_set_hash_match) verdictConsistent++;
    if (c.action_match && c.policy_hash_match) actionConsistent++;
  }

  const observed: ScenarioResult["observed"] = {
    executions: run.execution_ids.length,
    verdict: latest?.verdict ?? null,
    action: wf ? STATUS_ACTION[wf.status] : null,
    workflow_status: wf?.status ?? (execution ? execution.workflow_status : null),
    primary_rule: latest?.primary_failures[0] ?? null,
    receipts: receipts.length,
    ever_released: (wf?.history ?? []).some((h) => h.to === "RELEASED"),
    ever_held: (wf?.history ?? []).some((h) => h.to === "HELD"),
    final_sealed: evaluations.some((v) => v.mode === "FINAL" && v.verdict === "SEALED"),
    business_events: business,
    system_errors: [...new Set(systemErrors)],
    evidence_count: evidence.length,
  };

  // Expectations
  if (expected.no_execution) {
    if (run.execution_ids.length) failures.push(`expected no execution, got ${run.execution_ids.length}`);
  } else if (!execId && !expected.system_error) failures.push("no execution was created");
  if (expected.verdict && observed.verdict !== expected.verdict) failures.push(`verdict ${observed.verdict} ≠ ${expected.verdict}`);
  if (expected.action && observed.action !== expected.action) failures.push(`action ${observed.action} ≠ ${expected.action}`);
  if (expected.primary_rule && observed.primary_rule !== expected.primary_rule) failures.push(`primary rule ${observed.primary_rule} ≠ ${expected.primary_rule}`);
  if (expected.receipt_versions !== undefined && observed.receipts !== expected.receipt_versions) failures.push(`receipts ${observed.receipts} ≠ ${expected.receipt_versions}`);
  if (expected.system_error && !observed.system_errors.includes(expected.system_error)) failures.push(`expected system error ${expected.system_error}`);
  if (!expected.system_error && observed.system_errors.length) failures.push(`unexpected system errors ${observed.system_errors.join(",")}`);
  for (const [name, n] of Object.entries(expected.action_events ?? {})) {
    if ((business[name] ?? 0) !== n) failures.push(`${name} emitted ${business[name] ?? 0}× (expected ${n})`);
  }
  if (!expected.supported && observed.ever_released) failures.push("FALSE RELEASE: unsupported execution was released");
  if (releaseViolations) failures.push(`${releaseViolations} RELEASE ⇒ SEALED violations`);
  if (duplicateActions) failures.push(`${duplicateActions} duplicate operational events`);
  if (traceable !== evidence.length) failures.push(`provenance incomplete: ${traceable}/${evidence.length}`);
  if (consistent !== receipts.length) failures.push(`replay inconsistent: ${consistent}/${receipts.length}`);
  for (const check of scenario.checks) {
    if (check.startsWith("evidence_count:") && evidence.length !== Number(check.split(":")[1])) failures.push(`evidence count ${evidence.length} ≠ ${check.split(":")[1]}`);
    if (check === "all_ingest_401" && !run.ingest.every((i) => i.result.status === 401)) failures.push("not every delivery was rejected with 401");
    if (check === "no_applied_action" && (wf?.applied_decision_ids.length ?? 0) > 0) failures.push("an action was applied despite gate failure");
    if (check === "no_receipt" && receipts.length) failures.push("a receipt was generated without an applied action");
    if (check === "receipt_v1_preserved") {
      const v1 = receipts.find((r) => r.receipt_version === 1);
      const v2 = receipts.find((r) => r.receipt_version === 2);
      if (!v1 || !v2 || v2.supersedes !== v1.receipt_id) failures.push("receipt v2 must supersede preserved v1");
    }
  }
  if (expected.no_execution && (await rt.store.listRecentObservations()).length) failures.push("observations were created from rejected deliveries");

  return {
    id,
    scenario_id: scenario.scenario_id,
    label: scenario.label,
    category: scenario.category ?? "other",
    supported: expected.supported,
    expected: expected as Record<string, unknown>,
    observed,
    replay: { receipts: receipts.length, consistent, verdict_consistent: verdictConsistent, action_consistent: actionConsistent },
    provenance: { evidence: evidence.length, traceable },
    release_invariant_violations: releaseViolations,
    duplicate_action_events: duplicateActions,
    failures,
    passed: failures.length === 0,
  };
}

/** Engine determinism (Doc 03 §109) + pipeline demo reliability (Doc 02 §78). */
async function determinism(config: PipelineConfig) {
  const rt = new LocalRuntime({ config });
  const a = await rt.runScenario(JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/scenarios/correct-sequence.json"), "utf8")), { runId: "det-a" });
  const b = await rt.runScenario(JSON.parse(readFileSync(join(REPO_ROOT, "fixtures/scenarios/wrong-sequence.json"), "utf8")), { runId: "det-b" });
  let engineConsistent = true;
  for (const [execId, verdict] of [
    [a.execution_ids[0]!, "SEALED"],
    [b.execution_ids[0]!, "DEVIATED"],
  ] as const) {
    const evidence = await rt.store.listExecutionEvidence(execId);
    const first = evaluateExecution({ protocol: config.protocol, evidence, mode: "FINAL" });
    for (let i = 0; i < 100; i++) {
      const r = evaluateExecution({ protocol: config.protocol, evidence: [...evidence].reverse(), mode: "FINAL" });
      if (r.verdict !== verdict || r.input_hash !== first.input_hash || JSON.stringify(r.rule_results) !== JSON.stringify(first.rule_results)) engineConsistent = false;
    }
  }
  // Master Brief §22: 100 × A → SEALED → RELEASE and 100 × B → DEVIATED → HOLD through the pipeline.
  let pipelineExpected = 0;
  let aOk = 0;
  let bOk = 0;
  for (let i = 0; i < 100; i++) {
    for (const [file, status] of [
      ["fixtures/scenarios/correct-sequence.json", "RELEASED"],
      ["fixtures/scenarios/wrong-sequence.json", "HELD"],
    ] as const) {
      const r = await rt.runScenario(JSON.parse(readFileSync(join(REPO_ROOT, file), "utf8")), { runId: `rel-${i}-${status}` });
      const execution = (await rt.store.getExecution(r.execution_ids[0]!))!;
      const wf = (await rt.store.getWorkflow(r.execution_ids[0]!)).wf;
      const verdictOk = execution.latest_verdict === (status === "RELEASED" ? "SEALED" : "DEVIATED");
      if (wf?.status === status && wf.final && verdictOk) {
        pipelineExpected++;
        if (status === "RELEASED") aOk++;
        else bOk++;
      }
    }
  }
  return { engine_runs: 200, engine_consistent: engineConsistent, pipeline_runs: 200, pipeline_expected: pipelineExpected, a_sealed_released: aOk, b_deviated_held: bOk };
}

function gitCommit(): string | null {
  try {
    return readFileSync(join(REPO_ROOT, ".git", "HEAD"), "utf8").startsWith("ref:")
      ? readFileSync(join(REPO_ROOT, ".git", readFileSync(join(REPO_ROOT, ".git", "HEAD"), "utf8").slice(5).trim()), "utf8").trim()
      : readFileSync(join(REPO_ROOT, ".git", "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
}

export async function runBenchmark(): Promise<BenchmarkReport> {
  const manifest = loadManifest();
  const config = loadPipelineConfig();
  const scenarios: ScenarioResult[] = [];
  for (const s of manifest.scenarios) scenarios.push(await runScenarioBenchmark(s.id, s.file, config));

  const policy_checks = manifest.policy_checks.map((p) => {
    const r = validateActionPolicy(parseYaml(readFileSync(join(BENCH_DIR, p.file), "utf8")));
    const observed = r.valid ? "VALID" : "POLICY_INVALID";
    return { id: p.id, file: p.file, expect: p.expect, observed, passed: observed === p.expect, errors: r.errors };
  });

  const unsupported = scenarios.filter((s) => !s.supported);
  const supported = scenarios.filter((s) => s.supported);
  const withVerdict = scenarios.filter((s) => s.expected.verdict);
  const withAction = scenarios.filter((s) => s.expected.action);
  const sum = (f: (s: ScenarioResult) => number) => scenarios.reduce((n, s) => n + f(s), 0);

  return {
    benchmark: manifest.benchmark,
    generated_at: new Date().toISOString(),
    commit: gitCommit(),
    protocol: { ref: config.protocol.ref, hash: config.protocol.hash },
    action_policy: { ref: config.policy.ref, hash: config.policy.hash },
    engine_version: "seqseal-engine@0.1.0",
    interpreter: "mock-evidence-interpreter@1 (deterministic fixture hints)",
    scenarios,
    policy_checks,
    determinism: await determinism(config),
    metrics: {
      scenarios: scenarios.length,
      passed: scenarios.filter((s) => s.passed).length,
      unsupported: unsupported.length,
      supported: supported.length,
      false_sealed: unsupported.filter((s) => s.observed.final_sealed && !s.expected.system_error).length,
      false_release: unsupported.filter((s) => s.observed.ever_released).length,
      false_hold: supported.filter((s) => s.observed.ever_held).length,
      verdict_checked: withVerdict.length,
      verdict_correct: withVerdict.filter((s) => s.observed.verdict === s.expected.verdict).length,
      action_checked: withAction.length,
      action_correct: withAction.filter((s) => s.observed.action === s.expected.action).length,
      receipts: sum((s) => s.replay.receipts),
      replay_consistent: sum((s) => s.replay.consistent),
      verdict_replay_consistent: sum((s) => s.replay.verdict_consistent),
      action_replay_consistent: sum((s) => s.replay.action_consistent),
      evidence_items: sum((s) => s.provenance.evidence),
      evidence_traceable: sum((s) => s.provenance.traceable),
      release_invariant_violations: sum((s) => s.release_invariant_violations),
      duplicate_action_events: sum((s) => s.duplicate_action_events),
    },
  };
}
