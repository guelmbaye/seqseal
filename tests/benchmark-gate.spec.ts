/**
 * CI release gate (Doc 07 §113–115): the whole benchmark must pass and
 *   RELEASE ⇒ SEALED, False SEALED = 0, False RELEASE = 0,
 *   replay consistency = 100 %, provenance completeness = 100 %.
 */
import { describe, expect, it } from "vitest";
import { runBenchmark } from "../benchmarks/harness";

describe("benchmark release gate", () => {
  it("passes every scenario with zero false SEALED and zero false RELEASE", async () => {
    const r = await runBenchmark();
    const failing = r.scenarios.filter((s) => !s.passed).map((s) => `${s.id}: ${s.failures.join("; ")}`);
    expect(failing).toEqual([]);
    expect(r.metrics.false_sealed).toBe(0);
    expect(r.metrics.false_release).toBe(0);
    expect(r.metrics.release_invariant_violations).toBe(0);
    expect(r.metrics.duplicate_action_events).toBe(0);
    expect(r.metrics.replay_consistent).toBe(r.metrics.receipts);
    expect(r.metrics.evidence_traceable).toBe(r.metrics.evidence_items);
    expect(r.determinism.engine_consistent).toBe(true);
    expect(r.determinism.pipeline_expected).toBe(r.determinism.pipeline_runs);
    expect(r.policy_checks.every((p) => p.passed)).toBe(true);
  }, 120_000);
});
