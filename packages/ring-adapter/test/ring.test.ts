import { describe, expect, it } from "vitest";
import type { RawSourceRecord } from "@seqseal/contracts";
import {
  latestHistoryEvent,
  buildReplayDeliveries,
  buildRingWebhookEnvelope,
  classifyEventType,
  computeRingSignature,
  normalizeSourceRecord,
  parseOffset,
  parseRingWebhook,
  ReplayScenario,
  verifyRingSignature,
} from "../src";

const secret = "whsec-test";

describe("Ring webhook HMAC (X-Signature: sha256=<hex> over raw body)", () => {
  const body = JSON.stringify(buildRingWebhookEnvelope({ request_id: "r1", device_id: "d1", event_type: "motion_detected", sub_type: "human", occurred_at_ms: 1_760_796_000_000 }));

  it("accepts a valid signature computed over the raw bytes", () => {
    expect(verifyRingSignature(body, computeRingSignature(body, secret), secret)).toBe(true);
  });
  it("accepts the hex digest without the sha256= prefix", () => {
    expect(verifyRingSignature(body, computeRingSignature(body, secret).slice(7), secret)).toBe(true);
  });
  it("rejects a signature computed over re-serialized JSON", () => {
    const reserialized = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyRingSignature(body, computeRingSignature(reserialized, secret), secret)).toBe(false);
  });
  it("rejects tampered bodies, wrong secrets, missing or malformed headers", () => {
    const sig = computeRingSignature(body, secret);
    expect(verifyRingSignature(body.replace("human", "vehicle"), sig, secret)).toBe(false);
    expect(verifyRingSignature(body, computeRingSignature(body, "other"), secret)).toBe(false);
    expect(verifyRingSignature(body, undefined, secret)).toBe(false);
    expect(verifyRingSignature(body, "sha256=zz", secret)).toBe(false);
    expect(verifyRingSignature(body, sig, "")).toBe(false);
  });
});

describe("Ring JSON:API envelope", () => {
  it("parses the documented motion_detected shape", () => {
    const env = {
      meta: { version: "1.1", time: "2026-10-18T14:03:12Z", request_id: "req-1", account_id: "acct-1" },
      data: {
        id: "dev42_human_1760796180000",
        type: "motion_detected",
        subType: "human",
        attributes: { source: "dev42", source_type: "devices", timestamp: 1760796180000, component_ids: [0] },
        relationships: { devices: { links: { self: "/v1/devices/dev42" } } },
      },
    };
    const r = parseRingWebhook(env);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({ request_id: "req-1", account_id: "acct-1", event_id: "dev42_human_1760796180000", event_type: "motion_detected", sub_type: "human", device_id: "dev42", occurred_at_ms: 1760796180000, component_ids: ["0"] });
  });

  it("rejects envelopes without request_id", () => {
    expect(parseRingWebhook({ meta: {}, data: { id: "x", type: "motion_detected" } }).ok).toBe(false);
  });

  it("classifies physical vs integration-health vs unknown events", () => {
    expect(classifyEventType("motion_detected")).toBe("WORKFLOW_PHYSICAL");
    expect(classifyEventType("button_press")).toBe("WORKFLOW_PHYSICAL");
    expect(classifyEventType("device_offline")).toBe("INTEGRATION_HEALTH");
    expect(classifyEventType("unknown_future_event")).toBe("UNKNOWN");
  });
});

function record(payload: unknown, profile: RawSourceRecord["source_profile"] = "RING_WEBHOOK"): RawSourceRecord {
  return { source_record_id: "SRC-1", provider: "ring", source_profile: profile, idempotency_key: "k", received_at: "2026-10-18T14:06:10.000Z", signature_verified: true, correlation_id: "COR-1", payload };
}

describe("normalization", () => {
  it("keeps occurrence time separate from receive time and preserves component ids verbatim", () => {
    const env = buildRingWebhookEnvelope({ request_id: "r", device_id: "dev", event_type: "motion_detected", sub_type: "package_delivery", occurred_at_ms: Date.parse("2026-10-18T14:03:00Z"), component_ids: ["0"] });
    const n = normalizeSourceRecord(record(env));
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    expect(n.observation.occurred_at).toBe("2026-10-18T14:03:00.000Z");
    expect(n.observation.received_at).toBe("2026-10-18T14:06:10.000Z");
    expect(n.observation.source_component_refs).toEqual(["0"]);
    expect(n.observation.event_subtype).toBe("package_delivery");
    expect(n.observation.logical_zone).toBeUndefined(); // zones are a SEQSEAL binding concern
  });

  it("falls back to send time with explicit imprecision when the physical timestamp is missing", () => {
    const env = buildRingWebhookEnvelope({ request_id: "r", device_id: "dev", event_type: "motion_detected", sub_type: "human", occurred_at_ms: Date.parse("2026-10-18T14:03:00Z") });
    delete (env.data.attributes as Record<string, unknown>).timestamp;
    const n = normalizeSourceRecord(record(env));
    expect(n.ok && n.observation.time_precision_ms).toBe(30_000);
    expect(n.ok && n.observation.attributes.timestamp_source).toContain("fallback");
  });

  it("refuses Playground provenance without a successful Ring API call", () => {
    const capture = {
      capture_id: "cap-1",
      simulation_source: "PACKAGE",
      session_zone: "staging",
      captured_at: "2026-10-18T14:03:00Z",
      api_evidence: { method: "POST", endpoint: "/v1/devices/x/media/streaming/whep/sessions", http_status: 401 },
    };
    expect(normalizeSourceRecord(record(capture, "RING_PLAYGROUND")).ok).toBe(false);
    const ok = normalizeSourceRecord(record({ ...capture, api_evidence: { ...capture.api_evidence, http_status: 201 } }, "RING_PLAYGROUND"));
    expect(ok.ok && ok.observation.event_type).toBe("live_view_simulation");
    expect(ok.ok && ok.observation.source_profile).toBe("RING_PLAYGROUND");
  });
});

describe("fixture replay", () => {
  it("parses offsets", () => {
    expect(parseOffset(0, "+3m")).toBe(180_000);
    expect(parseOffset(0, "+2m30s")).toBe(150_000);
    expect(() => parseOffset(0, "+3 minutes")).toThrow();
  });

  it("builds documented-shape envelopes, duplicate deliveries, re-sent events and custom order", () => {
    const sc = ReplayScenario.parse({
      scenario_id: "t",
      label: "t",
      base_time: "2026-10-18T14:00:00Z",
      events: [
        { at: "+0m", type: "motion_detected", subtype: "vehicle", device: "a" },
        { at: "+3m", type: "motion_detected", subtype: "human", device: "b" },
      ],
      delivery_order: [1, 0],
      duplicate_deliveries: [0],
      duplicate_events: [1],
    });
    const d = buildReplayDeliveries(sc, { runId: "r" });
    expect(d.map((x) => `${x.event_index}:${x.kind}`)).toEqual(["1:original", "1:duplicate_event", "0:original", "0:duplicate_delivery"]);
    expect(d[2]!.request_id).toBe(d[3]!.request_id);
    expect(d[0]!.body.data.id).toBe(d[1]!.body.data.id);
    expect(d[0]!.request_id).not.toBe(d[1]!.request_id);
    expect(parseRingWebhook(d[0]!.body).ok).toBe(true);
  });
});

describe("Ring event history (tolerant, never invents an event)", () => {
  it("reads JSON:API data[] with epoch-ms attributes.timestamp and picks the newest", () => {
    const e = latestHistoryEvent({
      data: [
        { id: "evt-1", type: "on_demand", attributes: { timestamp: 1792332000000 } },
        { id: "evt-2", type: "on_demand", attributes: { timestamp: 1792332180000 } },
      ],
    });
    expect(e).toMatchObject({ event_id: "evt-2", event_type: "on_demand", occurred_at: "2026-10-18T14:03:00.000Z" });
  });

  it("reads the shape the Playground actually returned (attributes.start / end in epoch ms)", () => {
    // Verbatim items from GET /v1/history/devices/{id}/events, 2026-10-18 16:22–16:23 UTC (ids shortened).
    const item = (id: string, start: number, end: number) => ({
      type: "history-events",
      id,
      attributes: { end, is_third_party_reviewed: true, event_type: "on_demand", start },
      relationships: { cv_detections: { data: [] }, source: { data: { type: "devices", id: "ava1.ring.device.DJXHOX5" } } },
      meta: { riid: null },
    });
    const e = latestHistoryEvent({
      data: [item("ava1.ring.history.event.DZKCH44U", 1792340491490, 1792340513250), item("ava1.ring.history.event.R4BHNYLH", 1792340546024, 1792340567784)],
    });
    expect(e).toMatchObject({
      event_id: "ava1.ring.history.event.R4BHNYLH",
      event_type: "on_demand",
      occurred_at: "2026-10-18T16:22:26.024Z",
      ended_at: "2026-10-18T16:22:47.784Z",
    });
  });

  it("feeds the Ring start time, not the capture time, into the observation", () => {
    const capture = {
      capture_id: "pg-ava1.ring.history.event.DZKCH44U",
      simulation_source: "VEHICLE",
      session_zone: "receiving-entry",
      device_id: "ava1.ring.device.DJXHOX5",
      captured_at: "2026-10-18T16:22:24.866Z",
      api_evidence: { method: "GET", endpoint: "/v1/history/devices/ava1.ring.device.DJXHOX5/events", http_status: 200, request_id: "a38ea6fb-5ca2-48e9-8ee6-b5717d590ad8" },
      ring_event: { event_id: "ava1.ring.history.event.DZKCH44U", event_type: "on_demand", occurred_at: "2026-10-18T16:21:31.490Z", ended_at: "2026-10-18T16:21:53.250Z" },
    };
    const record: RawSourceRecord = {
      source_record_id: "raw-1",
      provider: "ring",
      source_profile: "RING_PLAYGROUND",
      idempotency_key: "idem-1",
      received_at: "2026-10-18T16:22:25.000Z",
      signature_verified: false,
      correlation_id: "corr-1",
      payload: capture,
    };
    const out = normalizeSourceRecord(record);
    if (!out.ok) throw new Error(out.error);
    expect(out.observation).toMatchObject({
      occurred_at: "2026-10-18T16:21:31.490Z",
      source_event_ref: "ava1.ring.history.event.DZKCH44U",
      attributes: { time_source: "ring history event start", ring_event_ended_at: "2026-10-18T16:21:53.250Z" },
    });
  });

  it("reads events[] with ISO created_at and event_type", () => {
    const e = latestHistoryEvent({ events: [{ event_id: 42, event_type: "motion", created_at: "2026-10-18T14:06:00Z" }] });
    expect(e).toMatchObject({ event_id: "42", event_type: "motion", occurred_at: "2026-10-18T14:06:00.000Z" });
  });

  it("returns undefined for shapes it cannot identify", () => {
    expect(latestHistoryEvent({ data: [{ foo: 1 }] })).toBeUndefined();
    expect(latestHistoryEvent({ message: "no events" })).toBeUndefined();
    expect(latestHistoryEvent(undefined)).toBeUndefined();
  });
});
