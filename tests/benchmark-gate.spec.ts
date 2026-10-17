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
    expect(r.metrics.verdict_replay_consistent).toBe(r.metrics.receipts);
    expect(r.metrics.action_replay_consistent).toBe(r.metrics.receipts);
    expect(r.metrics.evidence_traceable).toBe(r.metrics.evidence_items);
    expect(r.determinism.engine_consistent).toBe(true);
    expect(r.determinism.pipeline_expected).toBe(r.determinism.pipeline_runs);
    expect([r.determinism.a_sealed_released, r.determinism.b_deviated_held]).toEqual([100, 100]);
    expect(r.policy_checks.every((p) => p.passed)).toBe(true);
  }, 120_000);

  it("Master Brief §45 safety gates hold scenario by scenario", async () => {
    const r = await runBenchmark();
    for (const s of r.scenarios) {
      // if action == RELEASE: assert verdict == SEALED
      if (s.observed.action === "RELEASE") expect(s.observed.verdict, s.id).toBe("SEALED");
      // for unsupported scenario: assert action != RELEASE (now, or at any point in the workflow history)
      if (!s.supported) {
        expect(s.observed.action, s.id).not.toBe("RELEASE");
        expect(s.observed.ever_released, s.id).toBe(false);
      }
    }
    // The brief's minimum coverage list is present.
    const categories = new Set(r.scenarios.map((s) => s.id));
    for (const id of ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B12", "B13", "B15", "B16", "B17", "B19", "B20"]) expect(categories.has(id), id).toBe(true);
    expect(r.policy_checks.find((p) => p.id === "B14")?.observed).toBe("POLICY_INVALID");
  }, 120_000);
});
