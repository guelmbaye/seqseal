import { describe, expect, it } from "vitest";
import { ringProof } from "../apps/web/lib/provenance";

const dev = "ava1.ring.device.DJXHOX5NRJIDNGWFTA74YI45P4WJGLK6GPLAWU7HA7YHPDVQ4LRHUL2J4ZZK6FUOLZPKQSHJKXRNK2VYXYIPD4N5ZJIKO3RA";

describe("Ring proof shown in the evidence drawer", () => {
  it("names the Ring history event and says the time is its start", () => {
    const p = ringProof({
      api_method: "GET",
      api_endpoint: `/v1/history/devices/${dev}/events`,
      api_status: 200,
      ring_proof: "ring history event",
      ring_event_type: "on_demand",
      time_source: "ring history event start",
    });
    expect(p).toEqual({ kind: "event", label: "Ring history event (on_demand), read with GET /v1/history/devices/{device}/events, HTTP 200", time: "Start of the Ring event" });
  });

  it("says plainly when only a status call answered (the 16:55–17:09 session)", () => {
    const p = ringProof({ api_method: "GET", api_endpoint: `/v1/devices/${dev}/status`, api_status: 200, ring_proof: "ring api call only", time_source: "capture time" });
    expect(p?.kind).toBe("api-call");
    expect(p?.label).toBe("Ring API call only: GET /v1/devices/{device}/status, HTTP 200");
    expect(p?.time).toBe("Capture time");
    expect(p?.note).toMatch(/does not prove that the simulation itself ran/);
  });

  it("reads captures recorded before ring_proof existed", () => {
    expect(ringProof({ api_endpoint: "/v1/history/x/events", ring_event_type: "on_demand", time_source: "capture time" })?.time).toBe(
      "Capture time (Ring gave no time for the event)",
    );
    expect(ringProof({ api_endpoint: "/v1/devices/x/status", time_source: "capture time" })?.kind).toBe("api-call");
  });

  it("stays silent for sources that are not Playground captures", () => {
    expect(ringProof(undefined)).toBeUndefined();
    expect(ringProof({ subtype_source: "data.subType" })).toBeUndefined();
  });
});
