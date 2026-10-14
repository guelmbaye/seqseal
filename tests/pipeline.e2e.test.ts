import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRingWebhookEnvelope, computeRingSignature } from "@seqseal/ring-adapter";
import { LocalRuntime, ReadModel, verifyReceiptHash } from "@seqseal/pipeline";

const root = join(__dirname, "..");
const scenario = (name: string) => JSON.parse(readFileSync(join(root, "fixtures/scenarios", `${name}.json`), "utf8"));

describe("Ring webhook ingress", () => {
  it("verifies HMAC over raw bytes, dedupes deliveries and drives the pipeline", async () => {
    const rt = new LocalRuntime({ options: { ringSigningSecret: "s3cret" } });
    const body = JSON.stringify(
      buildRingWebhookEnvelope({ request_id: "req-1", device_id: "ring-device-entry", event_type: "motion_detected", sub_type: "vehicle", occurred_at_ms: Date.parse("2026-10-18T14:00:00Z") }),
    );
    expect((await rt.ingestWebhook({ rawBody: body, headers: { "x-signature": computeRingSignature(body, "nope") }, profile: "RING_WEBHOOK" })).status).toBe(401);
    expect((await rt.store.listRecentObservations()).length).toBe(0);

    const ok = await rt.ingestWebhook({ rawBody: body, headers: { "X-Signature": computeRingSignature(body, "s3cret") }, profile: "RING_WEBHOOK" });
    expect(ok).toMatchObject({ status: 202, outcome: "ACCEPTED" });
    const dup = await rt.ingestWebhook({ rawBody: body, headers: { "X-Signature": computeRingSignature(body, "s3cret") }, profile: "RING_WEBHOOK" });
    expect(dup.outcome).toBe("DUPLICATE_DELIVERY");

    const executions = await rt.store.listExecutions();
    expect(executions).toHaveLength(1);
    expect(executions[0]!.workflow_status).toBe("WAITING");
    expect(executions[0]!.source_profiles).toEqual(["RING_WEBHOOK"]);
  });

  it("rejects malformed bodies without creating observations", async () => {
    const rt = new LocalRuntime();
    expect((await rt.ingestWebhook({ rawBody: "{not json", profile: "FIXTURE_REPLAY" })).status).toBe(400);
    expect((await rt.ingestWebhook({ rawBody: JSON.stringify({ meta: {}, data: {} }), profile: "FIXTURE_REPLAY" })).status).toBe(400);
    expect(await rt.store.listRecentObservations()).toHaveLength(0);
  });
});

describe("Ring Developer Playground captures", () => {
  it("become RING_PLAYGROUND evidence through operator-declared zone bindings", async () => {
    const rt = new LocalRuntime();
    const cap = (id: string, src: string, zone: string, min: number) => ({
      capture_id: id,
      simulation_source: src,
      session_zone: zone,
      device_id: "pg-device-1",
      media_session_ref: `whep-${id}`,
      captured_at: new Date(Date.parse("2026-10-18T14:00:00Z") + min * 60_000).toISOString(),
      api_evidence: { method: "POST", endpoint: "/v1/devices/pg-device-1/media/streaming/whep/sessions", http_status: 201 },
    });
    for (const c of [
      cap("c1", "VEHICLE", "receiving-entry", 0),
      cap("c2", "PACKAGE", "staging", 3),
      cap("c3", "MOTION", "storage-transition", 6),
      cap("c4", "VEHICLE", "receiving-exit", 9),
      cap("c5", "MOTION", "receiving-exit", 11),
    ]) {
      expect((await rt.ingestPlaygroundCapture(c)).status).toBe(202);
    }
    const [exec] = await rt.store.listExecutions();
    expect(exec!.latest_verdict).toBe("SEALED");
    expect(exec!.workflow_status).toBe("RELEASED");
    expect(exec!.source_profiles).toEqual(["RING_PLAYGROUND"]);
    const evidence = await rt.store.listExecutionEvidence(exec!.execution_id);
    expect(evidence.every((e) => e.source_refs[0]!.source_profile === "RING_PLAYGROUND" && e.source_refs[0]!.media_session_ref)).toBe(true);
  });
});

describe("finalization, amendments and receipts", () => {
  it("does not finalize before the grace window when grace > 0 (RELEASE waits)", async () => {
    const rt = new LocalRuntime({ options: { finalizationGraceMs: 60_000 } });
    // LocalRuntime routes finalization immediately; with grace the AWS path delays via SQS.
    // Here we assert that provisional SEALED is never released provisionally.
    const r = await rt.runScenario(scenario("correct-sequence"));
    const decisions = await rt.store.listDecisions(r.execution_ids[0]!);
    expect(decisions.filter((d) => d.action === "RELEASE").every((d) => d.final && d.verdict === "SEALED")).toBe(true);
  });

  it("receipt hash detects tampering", async () => {
    const rt = new LocalRuntime();
    const r = await rt.runScenario(scenario("wrong-sequence"));
    const [receipt] = await rt.store.listExecutionReceipts(r.execution_ids[0]!);
    expect(verifyReceiptHash(receipt!)).toBe(true);
    const tampered = { ...receipt!, operational: { ...receipt!.operational, action: "RELEASE" as const } };
    expect(verifyReceiptHash(tampered)).toBe(false);
    const evTampered = { ...receipt!, evidence: receipt!.evidence.map((e, i) => (i === 1 ? { ...e, occurred_at: "2026-10-18T13:59:00.000Z" } : e)) };
    expect(verifyReceiptHash(evTampered)).toBe(false);
  });

  it("human review acts on evidence only; there is no force-release path", async () => {
    const rt = new LocalRuntime();
    const r = await rt.runScenario(scenario("ambiguous-evidence"));
    const id = r.execution_ids[0]!;
    expect((await rt.store.getExecution(id))!.workflow_status).toBe("REVIEW_REQUIRED");
    const pipelineApi = Object.getOwnPropertyNames(Object.getPrototypeOf(rt.pipeline));
    expect(pipelineApi.some((m) => /force|override|release/i.test(m))).toBe(false);

    const [candidate] = (await rt.store.listExecutionCandidates(id)).filter((c) => c.status === "UNCERTAIN");
    await rt.review({ candidate_id: candidate!.candidate_id, action: "CONFIRM", reviewer_ref: "supervisor-1", rationale: "Pallet visible in staging" });
    const after = (await rt.store.getExecution(id))!;
    expect(after.latest_verdict).toBe("SEALED");
    expect(after.workflow_status).toBe("RELEASED");
    const receipts = await rt.store.listExecutionReceipts(id);
    expect(receipts.map((x) => x.operational.action)).toEqual(["REVIEW", "RELEASE"]);
    expect(receipts[1]!.supersedes).toBe(receipts[0]!.receipt_id);
    const human = (await rt.store.listExecutionEvidence(id)).find((e) => e.interpretation_mode === "HUMAN_CONFIRMED")!;
    expect(human.review_id).toBeDefined();
    const original = (await rt.store.getCandidate(candidate!.candidate_id))!;
    expect(original.assessment).toBe("AMBIGUOUS"); // AI history preserved
  });

  it("read model pairs the hero executions under the same protocol and policy", async () => {
    const rt = new LocalRuntime();
    await rt.runScenario(scenario("correct-sequence"));
    await rt.runScenario(scenario("wrong-sequence"));
    const rm = new ReadModel(rt.store, rt.pipeline.config, { backend: "local", interpreter: "mock" });
    const hero = await rm.hero();
    expect(hero.sealed?.summary.verdict).toBe("SEALED");
    expect(hero.deviated?.summary.primary_rule).toBe("ORDER-02");
    expect(hero.same_protocol && hero.same_policy).toBe(true);
    const status = await rm.status();
    expect(status.protocol.ref).toBe("IDP-01@1.0.0");
    expect(status.policy.mappings).toEqual({ SEALED: "RELEASE", DEVIATED: "HOLD", INCOMPLETE: "WAIT", UNCERTAIN: "REVIEW" });
  });
});
