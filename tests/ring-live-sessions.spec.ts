/**
 * Regression on real Ring data: the deliveries captured live through the Ring Developer Playground
 * (`ring-spike.ts run --delivery A|B`) on 2026-10-19, and on 2026-10-21 with every capture processed
 * on the AWS deployment, replayed through the normal pipeline as Ring-derived replay. Every step is
 * a Ring history event; nothing here is constructed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalRuntime, ReadModel } from "@seqseal/pipeline";

const root = join(__dirname, "..");
const session = (name: string) =>
  readFileSync(join(root, "fixtures/ring/captures", `${name}.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { ring_event?: { event_id: string; occurred_at?: string }; api_evidence: { http_status: number; request_id?: string } });

async function replay(name: string) {
  const rt = new LocalRuntime();
  await rt.runCaptures(session(name), { session: name });
  const [exec] = await rt.store.listExecutions();
  const rm = new ReadModel(rt.store, rt.pipeline.config, { backend: "local", interpreter: "mock" });
  return rm.executionDetail(exec!.execution_id);
}

describe("live Ring Developer Playground sessions of 2026-10-19", () => {
  it("are made only of Ring history events answered with HTTP 200", () => {
    for (const name of ["live-2026-10-19-a", "live-2026-10-19-b"]) {
      const caps = session(name);
      expect(caps).toHaveLength(5);
      for (const c of caps) {
        expect(c.ring_event?.event_id).toMatch(/^ava1\.ring\.history\.event\./);
        expect(c.ring_event?.occurred_at).toBeTruthy();
        expect(c.api_evidence.http_status).toBe(200);
        expect(c.api_evidence.request_id).toBeTruthy();
      }
    }
  });

  it("Delivery A replays to SEALED -> RELEASE", async () => {
    const d = await replay("live-2026-10-19-a");
    expect(d?.summary).toMatchObject({ verdict: "SEALED", action: "RELEASE", workflow_status: "RELEASED" });
    expect(d?.summary.source_profiles).toEqual(["RING_DERIVED_REPLAY"]);
    // Every accepted step points at its Ring event and takes the Ring event's start as its time.
    for (const o of d!.observations) {
      expect(o.source_event_ref).toMatch(/^ava1\.ring\.history\.event\./);
      expect(o.attributes).toMatchObject({ ring_proof: "ring history event", time_source: "ring history event start" });
    }
  });

  it("Delivery B replays to DEVIATED -> HOLD on ORDER-02, Storage 54 s before Staging", async () => {
    const d = await replay("live-2026-10-19-b");
    expect(d?.summary).toMatchObject({ verdict: "DEVIATED", action: "HOLD", workflow_status: "HELD", primary_rule: "ORDER-02" });
    expect(d?.summary.explanation).toBe("STORAGE occurred 54 s before required STAGING. (ORDER-02)");
  });
});

describe.each([
  ["16:19 UTC", "live-2026-10-21-a", "live-2026-10-21-b"],
  ["17:05 UTC, filmed for the video", "live-2026-10-21-1705-a", "live-2026-10-21-1705-b"],
])("live sessions of 2026-10-21, %s (processed live on AWS)", (_when, a, b) => {
  it("are made only of Ring history events answered with HTTP 200, none reused", () => {
    const ids = [...session(a), ...session(b)].map((c) => c.ring_event?.event_id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const c of [...session(a), ...session(b)]) {
      expect(c.ring_event?.event_id).toMatch(/^ava1\.ring\.history\.event\./);
      expect(c.api_evidence.http_status).toBe(200);
      expect(c.api_evidence.request_id).toBeTruthy();
    }
  });

  it("Delivery A replays to SEALED -> RELEASE -> RELEASED, as it did on AWS", async () => {
    const d = await replay(a);
    expect(d?.summary).toMatchObject({ verdict: "SEALED", action: "RELEASE", workflow_status: "RELEASED" });
  });

  it("Delivery B replays to DEVIATED -> HOLD on ORDER-02, Storage 49 s before Staging, as it did on AWS", async () => {
    const d = await replay(b);
    expect(d?.summary).toMatchObject({ verdict: "DEVIATED", action: "HOLD", workflow_status: "HELD", primary_rule: "ORDER-02" });
    expect(d?.summary.explanation).toBe("STORAGE occurred 49 s before required STAGING. (ORDER-02)");
  });
});
