/**
 * pnpm benchmark            → run, print, write benchmarks/results/latest.{json,md}
 * pnpm benchmark --check    → additionally exit 1 on any failure (CI release gate)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCH_DIR, runBenchmark, type BenchmarkReport } from "./harness";

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}%`);

function markdown(r: BenchmarkReport): string {
  const m = r.metrics;
  const lines = [
    `# SEQSEAL benchmark results — ${r.benchmark}`,
    ``,
    `Generated ${r.generated_at} · commit \`${r.commit ?? "uncommitted"}\``,
    ``,
    `Protocol \`${r.protocol.ref}\` (${r.protocol.hash.slice(0, 19)}…) · Action policy \`${r.action_policy.ref}\` (${r.action_policy.hash.slice(0, 19)}…) · ${r.engine_version} · interpreter: ${r.interpreter}`,
    ``,
    `> Engineering run on the defined benchmark only. These numbers are bounded to these ${m.scenarios} constructed scenarios; they are not real-world accuracy claims.`,
    ``,
    `## Safety metrics`,
    ``,
    `| Metric | Result |`,
    `|---|---|`,
    `| False SEALED (unsupported executions SEALED) | **${m.false_sealed}/${m.unsupported}** |`,
    `| False RELEASE (unsupported executions RELEASED) | **${m.false_release}/${m.unsupported}** |`,
    `| False HOLD (supported executions HELD) | ${m.false_hold}/${m.supported} |`,
    `| RELEASE ⇒ SEALED violations | ${m.release_invariant_violations} |`,
    `| Duplicate operational events | ${m.duplicate_action_events} |`,
    `| Verdict accuracy | ${m.verdict_correct}/${m.verdict_checked} (${pct(m.verdict_correct, m.verdict_checked)}) |`,
    `| Action accuracy | ${m.action_correct}/${m.action_checked} (${pct(m.action_correct, m.action_checked)}) |`,
    `| Receipt replay consistency (verdict + action + hashes) | ${m.replay_consistent}/${m.receipts} (${pct(m.replay_consistent, m.receipts)}) |`,
    `| Provenance completeness (evidence → observation → raw source) | ${m.evidence_traceable}/${m.evidence_items} (${pct(m.evidence_traceable, m.evidence_items)}) |`,
    `| Engine determinism (100× A + 100× B, shuffled input order) | ${r.determinism.engine_consistent ? "consistent" : "INCONSISTENT"} |`,
    `| Pipeline reliability (10× A→RELEASED, 10× B→HELD) | ${r.determinism.pipeline_expected}/${r.determinism.pipeline_runs} |`,
    `| Scenarios passing all assertions | ${m.passed}/${m.scenarios} |`,
    ``,
    `## Scenarios`,
    ``,
    `| ID | Scenario | Expected | Observed | Primary rule | Receipts | Result |`,
    `|---|---|---|---|---|---|---|`,
    ...r.scenarios.map((s) => {
      const exp = s.expected.no_execution ? "no execution" : [s.expected.verdict, s.expected.action].filter(Boolean).join(" → ") || `system error ${String(s.expected.system_error)}`;
      const obs = s.observed.executions === 0 ? "no execution" : [s.observed.verdict ?? "—", s.observed.action ?? s.observed.workflow_status ?? "—"].join(" → ") + (s.observed.system_errors.length ? ` (${s.observed.system_errors.join(",")})` : "");
      return `| ${s.id} | ${s.label} | ${exp} | ${obs} | ${s.observed.primary_rule ?? "—"} | ${s.observed.receipts} | ${s.passed ? "PASS" : `FAIL: ${s.failures.join("; ")}`} |`;
    }),
    ``,
    `## Action-policy activation checks`,
    ``,
    `| ID | Policy | Expected | Observed |`,
    `|---|---|---|---|`,
    ...r.policy_checks.map((p) => `| ${p.id} | \`${p.file}\` | ${p.expect} | ${p.observed}${p.errors.length ? ` — ${p.errors.join("; ")}` : ""} |`),
    ``,
  ];
  return lines.join("\n");
}

const report = await runBenchmark();
const out = join(BENCH_DIR, "results");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "latest.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(out, "latest.md"), markdown(report));

const m = report.metrics;
console.log(markdown(report).split("\n## Scenarios")[0]);
for (const s of report.scenarios) console.log(`${s.passed ? "✓" : "✕"} ${s.id.padEnd(5)} ${s.label}${s.passed ? "" : `\n     ${s.failures.join("\n     ")}`}`);
for (const p of report.policy_checks) console.log(`${p.passed ? "✓" : "✕"} ${p.id.padEnd(5)} policy ${p.file} → ${p.observed}`);

const ok =
  m.passed === m.scenarios &&
  m.false_sealed === 0 &&
  m.false_release === 0 &&
  m.release_invariant_violations === 0 &&
  m.duplicate_action_events === 0 &&
  m.replay_consistent === m.receipts &&
  m.evidence_traceable === m.evidence_items &&
  report.determinism.engine_consistent &&
  report.determinism.pipeline_expected === report.determinism.pipeline_runs &&
  report.policy_checks.every((p) => p.passed);
console.log(`\n${ok ? "RELEASE GATE: PASS" : "RELEASE GATE: FAIL"}  (results in benchmarks/results/latest.md)`);
if (process.argv.includes("--check") && !ok) process.exit(1);
