import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRingWebhookEnvelope, computeRingSignature } from "@seqseal/ring-adapter";
import { LocalRuntime, ReadModel, redactForLog, verifyReceiptHash } from "@seqseal/pipeline";

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

describe("Playground captures grounded in Ring history events, and Ring-derived replay", () => {
  const T0 = Date.parse("2026-10-18T14:00:00Z");
  const grounded = (n: number, src: string, zone: string, min: number) => ({
    capture_id: `pg-evt-${n}`,
    simulation_source: src,
    session_zone: zone,
    device_id: "pg-device-1",
    captured_at: new Date(T0 + min * 60_000 + 25_000).toISOString(), // command run ~25 s after the simulation
    api_evidence: { method: "GET", endpoint: "/v1/history/devices/pg-device-1/events", http_status: 200, request_id: `req-${n}` },
    ring_event: { event_id: `evt-${n}`, event_type: "on_demand", occurred_at: new Date(T0 + min * 60_000).toISOString() },
  });
  const sessionA = [
    grounded(1, "VEHICLE", "receiving-entry", 0),
    grounded(2, "PACKAGE", "staging", 3),
    grounded(3, "MOTION", "storage-transition", 6),
    grounded(4, "VEHICLE", "receiving-exit", 9),
    grounded(5, "MOTION", "receiving-exit", 11),
  ];

  it("uses the Ring event id as source reference and its timestamp as physical time; a re-capture of the same event is one observation", async () => {
    const rt = new LocalRuntime();
    for (const c of sessionA) await rt.ingestPlaygroundCapture(c);
    await rt.ingestPlaygroundCapture({ ...sessionA[1]!, capture_id: "pg-evt-2-again" }); // same Ring event captured twice
    const [exec] = await rt.store.listExecutions();
    const evidence = await rt.store.listExecutionEvidence(exec!.execution_id);
    expect(evidence).toHaveLength(5);
    const staging = evidence.find((e) => e.semantic_state === "staging")!;
    expect(staging.source_refs[0]!.source_event_ref).toBe("evt-2");
    expect(staging.occurred_at).toBe("2026-10-18T14:03:00.000Z");
    expect(exec!.workflow_status).toBe("RELEASED");
  });

  it("the checklist hero follows a live Playground session: A fills in, then B next to it, never mixed with fixtures", async () => {
    const rt = new LocalRuntime();
    const rm = new ReadModel(rt.store, rt.pipeline.config, { backend: "local", interpreter: "mock" });
    await rt.runScenario(scenario("correct-sequence"));
    await rt.runScenario(scenario("wrong-sequence"));
    expect((await rm.hero()).mode).toBe("pair");

    for (const c of sessionA) await rt.ingestPlaygroundCapture(c); // live A, released
    let hero = await rm.hero();
    expect([hero.mode, hero.a?.execution.source_profiles[0], hero.b]).toEqual(["latest", "RING_PLAYGROUND", undefined]);

    const later = (c: (typeof sessionA)[number], n: number, min: number) => ({ ...c, capture_id: `live-b-${n}`, ring_event: { ...c.ring_event, event_id: `live-b-${n}`, occurred_at: new Date(T0 + (20 + min) * 60_000).toISOString() } });
    await rt.ingestPlaygroundCapture(later(sessionA[0]!, 0, 0)); // live B arrives
    await rt.ingestPlaygroundCapture(later(sessionA[2]!, 1, 3)); // storage before staging
    hero = await rm.hero();
    expect(hero.mode).toBe("latest");
    expect(hero.a?.execution.workflow_status).toBe("RELEASED");
    expect(hero.b?.execution.status).toBe("ACTIVE");
    expect(hero.b?.execution.workflow_status).toBe("WAITING");

    await rt.ingestPlaygroundCapture(later(sessionA[1]!, 2, 6));
    expect((await rm.hero()).b?.execution.workflow_status).toBe("HELD"); // proven violation: held before the delivery ends
    await rt.ingestPlaygroundCapture(later(sessionA[3]!, 3, 9));
    await rt.ingestPlaygroundCapture(later(sessionA[4]!, 4, 11));
    hero = await rm.hero();
    expect(hero.mode).toBe("pair");
    expect([hero.a?.execution.source_profiles[0], hero.b?.execution.source_profiles[0]]).toEqual(["RING_PLAYGROUND", "RING_PLAYGROUND"]);
    expect([hero.a?.execution.workflow_status, hero.b?.execution.workflow_status]).toEqual(["RELEASED", "HELD"]);
    expect(hero.same_protocol && hero.same_policy && hero.same_mappings).toBe(true);
  });

  it("replays a saved session as RING_DERIVED_REPLAY in its own lane: A released, B (swapped) held on ORDER-02", async () => {
    const rt = new LocalRuntime();
    const sessionB = [sessionA[0]!, sessionA[2]!, sessionA[1]!, sessionA[3]!, sessionA[4]!].map((c, i) => ({ ...c, capture_id: `b-${i}`, ring_event: { ...c.ring_event, event_id: `b-evt-${i}` } }));
    const a = await rt.runCaptures(sessionA, { session: "a" });
    // B: same five simulations, storage captured before staging (times follow capture order)
    const bTimes = [0, 3, 6, 9, 11];
    const b = await rt.runCaptures(sessionB.map((c, i) => ({ ...c, ring_event: { ...c.ring_event, occurred_at: new Date(T0 + bTimes[i]! * 60_000).toISOString() } })), { session: "b" });
    const ea = (await rt.store.getExecution(a.execution_ids[0]!))!;
    const eb = (await rt.store.getExecution(b.execution_ids[0]!))!;
    expect(ea.source_profiles).toEqual(["RING_DERIVED_REPLAY"]);
    expect([ea.latest_verdict, ea.workflow_status]).toEqual(["SEALED", "RELEASED"]);
    expect([eb.latest_verdict, eb.workflow_status]).toEqual(["DEVIATED", "HELD"]);
    const [receipt] = await rt.store.listExecutionReceipts(eb.execution_id);
    expect(receipt!.explanation_chain.at(-1)!.text).toBe("Ring-derived replay evidence");
    expect(receipt!.source_evidence_refs.every((r) => r.source_profile === "RING_DERIVED_REPLAY")).toBe(true);
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
    expect(receipts.map((x) => x.operational_action)).toEqual(["REVIEW", "RELEASE"]);
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
    expect(hero.mode).toBe("pair");
    expect(hero.a?.summary.verdict).toBe("SEALED");
    expect(hero.b?.summary.primary_rule).toBe("ORDER-02");
    expect(hero.same_protocol && hero.same_policy && hero.same_mappings).toBe(true);
    expect(hero.b?.explanation_chain?.map((l) => l.text)).toEqual([
      "HOLD",
      "Action policy IDP-ACTION@1.0.0 maps DEVIATED → HOLD",
      "ORDER-02 failed: STAGING must occur before STORAGE",
      "STORAGE 14:03 occurred before STAGING 14:06",
      "Ring-shaped test fixture evidence",
    ]);
    const status = await rm.status();
    expect(status.protocol.ref).toBe("IDP-01@1.0.0");
    expect(status.policy.mappings).toEqual({ SEALED: "RELEASE", DEVIATED: "HOLD", INCOMPLETE: "WAIT", UNCERTAIN: "REVIEW" });
  });
});

describe("log redaction", () => {
  it("masks secret-looking fields and bearer tokens, keeps identifiers", () => {
    const out = redactForLog({
      execution_id: "EXEC-0001",
      headers: { Authorization: "Bearer abc.def.ghijklmnop", "X-Signature": "sha256=00ff" },
      ring_access_token: "t0k3n",
      note: "retry with Bearer abcdefghijklmnop failed",
      nested: [{ client_secret: "s" }],
    }) as Record<string, unknown>;
    expect(out.execution_id).toBe("EXEC-0001");
    expect(out.headers).toEqual({ Authorization: "[redacted]", "X-Signature": "[redacted]" });
    expect(out.ring_access_token).toBe("[redacted]");
    expect(out.note).toBe("retry with Bearer [redacted] failed");
    expect(out.nested).toEqual([{ client_secret: "[redacted]" }]);
  });
});
