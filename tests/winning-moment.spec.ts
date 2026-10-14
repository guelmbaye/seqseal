/**
 * The code embodiment of the pitch (Doc 09 §97):
 *
 *   Same observations. Different sequence. Different operational action.
 *
 * Both executions go through the REAL pipeline (Ring-shaped source events → normalization →
 * bindings → evidence → PWPS engine → action policy → Operational Gate → receipt) with the
 * same source profile, same mappings, same protocol, same policy and same engine.
 * Only the physical order changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DisabledEvidenceInterpreter } from "@seqseal/evidence-model";
import { LocalRuntime, replayReceipt } from "@seqseal/pipeline";

const root = join(__dirname, "..");
const A = JSON.parse(readFileSync(join(root, "fixtures/scenarios/correct-sequence.json"), "utf8"));
const B = JSON.parse(readFileSync(join(root, "fixtures/scenarios/wrong-sequence.json"), "utf8"));

async function runPair(rt: LocalRuntime, suffix = "") {
  // Each run id is an isolated replay "site"; reusing one would (correctly) be deduplicated.
  const a = await rt.runScenario(A, { runId: `wm-a${suffix}` });
  const b = await rt.runScenario(B, { runId: `wm-b${suffix}` });
  const load = async (id: string) => {
    const execution = (await rt.store.getExecution(id))!;
    const evaluation = (await rt.store.getEvaluation(execution.latest_evaluation_id!))!;
    const evidence = await rt.store.listExecutionEvidence(id);
    const candidates = await rt.store.listExecutionCandidates(id);
    const { wf } = await rt.store.getWorkflow(id);
    const receipts = await rt.store.listExecutionReceipts(id);
    return { execution, evaluation, evidence, candidates, wf: wf!, receipts };
  };
  return { a: await load(a.execution_ids[0]!), b: await load(b.execution_ids[0]!), events: [...a.events, ...b.events], aId: a.execution_ids[0]!, bId: b.execution_ids[0]! };
}

describe("Winning Moment", () => {
  it("same observations, different sequence → SEALED/RELEASE vs DEVIATED/HOLD", async () => {
    const rt = new LocalRuntime();
    const { a, b, events, aId, bId } = await runPair(rt);

    // Hold constant: protocol, policy, engine, source profile, state vocabulary, mappings.
    expect(a.evaluation.protocol_hash).toBe(b.evaluation.protocol_hash);
    expect(a.execution.action_policy_ref).toBe(b.execution.action_policy_ref);
    expect(a.evaluation.engine_version).toBe(b.evaluation.engine_version);
    expect(a.execution.source_profiles).toEqual(b.execution.source_profiles);
    expect(new Set(a.evidence.map((e) => e.semantic_state))).toEqual(new Set(b.evidence.map((e) => e.semantic_state)));
    expect(new Set(a.candidates.map((c) => c.mapping_id))).toEqual(new Set(b.candidates.map((c) => c.mapping_id)));
    expect(a.receipts[0]!.protocol.hash).toBe(b.receipts[0]!.protocol.hash);
    expect(a.receipts[0]!.action_policy.hash).toBe(b.receipts[0]!.action_policy.hash);

    // Change only: order.
    expect(a.evaluation.observed_sequence.map((s) => s.state)).toEqual(["arrival", "staging", "storage", "departure", "clear"]);
    expect(b.evaluation.observed_sequence.map((s) => s.state)).toEqual(["arrival", "storage", "staging", "departure", "clear"]);

    // Observe: different verdict, different action, real business events, receipts.
    expect(a.evaluation.verdict).toBe("SEALED");
    expect(a.wf.status).toBe("RELEASED");
    expect(b.evaluation.verdict).toBe("DEVIATED");
    expect(b.evaluation.primary_failures).toEqual(["ORDER-02"]);
    expect(b.wf.status).toBe("HELD");
    expect(events.filter((e) => e.name === "WorkflowReleased" && e.execution_id === aId)).toHaveLength(1);
    expect(events.filter((e) => e.name === "WorkflowHeld" && e.execution_id === bId)).toHaveLength(1);
    expect(events.filter((e) => e.name === "WorkflowReleased" && e.execution_id === bId)).toHaveLength(0);
    expect(a.receipts[0]!.operational).toMatchObject({ action: "RELEASE", applied: true, workflow_status: "RELEASED", event_type: "WorkflowReleased" });
    expect(b.receipts[0]!.operational).toMatchObject({ action: "HOLD", applied: true, workflow_status: "HELD" });
  });

  it("ORDER-02 evidence traces back to Ring-shaped source events (action → verdict → rule → evidence → observation → source)", async () => {
    const rt = new LocalRuntime();
    const { b } = await runPair(rt);
    const order02 = b.evaluation.rule_results.find((r) => r.rule_id === "ORDER-02")!;
    expect(order02.status).toBe("FAIL");
    expect(order02.explanation).toBe("STORAGE occurred 3 min before required STAGING.");
    for (const evId of order02.evidence_refs) {
      const e = (await rt.store.getEvidence(evId))!;
      const o = (await rt.store.getObservation(e.observation_refs[0]!))!;
      const raw = (await rt.store.getRawRecord(o.raw_source_ref))!;
      expect(o.event_type).toBe("motion_detected");
      expect(e.source_refs[0]!.source_event_ref).toBe(o.source_event_ref);
      expect((raw.payload as { data: { id: string } }).data.id).toBe(o.source_event_ref);
    }
  });

  it("works with AI disabled (BEDROCK_DISABLED) — the hero path is deterministic", async () => {
    const rt = new LocalRuntime({ interpreter: new DisabledEvidenceInterpreter() });
    const { a, b } = await runPair(rt);
    expect([a.wf.status, b.wf.status]).toEqual(["RELEASED", "HELD"]);
  });

  it("10 × A and 10 × B through the pipeline: 20/20 expected outcomes, every receipt replays", async () => {
    const rt = new LocalRuntime();
    for (let i = 0; i < 10; i++) {
      const { a, b } = await runPair(rt, `-${i}`);
      expect(a.wf.status).toBe("RELEASED");
      expect(b.wf.status).toBe("HELD");
      for (const r of [...a.receipts, ...b.receipts]) expect((await replayReceipt(rt.store, rt.pipeline.config, r)).consistent).toBe(true);
    }
  });
});
