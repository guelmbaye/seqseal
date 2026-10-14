import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compilePwpsFile } from "@pwps/core";
import type { NormalizedObservation } from "@seqseal/contracts";
import {
  applyAcceptance,
  bindObservation,
  computeCoverage,
  interpretationJsonSchema,
  InterpretationSchemaError,
  loadAcceptancePolicyFile,
  loadSourceConfigFile,
  MockEvidenceInterpreter,
  resolveObservation,
  validateInterpretationOutput,
  validateSourceConfigAgainstProtocol,
} from "../src";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const protocol = compilePwpsFile(join(root, "protocols", "inbound-delivery.yaml"));
const sources = loadSourceConfigFile(join(root, "config", "inbound-delivery.sources.yaml"));
const acceptance = loadAcceptancePolicyFile(join(root, "policies", "evidence-acceptance-default.yaml"));
const now = "2026-10-18T14:10:00.000Z";

function obs(p: Partial<NormalizedObservation>): NormalizedObservation {
  return {
    schema_version: "1.0",
    observation_id: "OBS-1",
    correlation_id: "COR-1",
    family: "WORKFLOW_PHYSICAL",
    source_provider: "ring",
    source_profile: "RING_WEBHOOK",
    source_component_refs: [],
    source_event_ref: "ev-1",
    event_type: "motion_detected",
    occurred_at: "2026-10-18T14:03:00.000Z",
    received_at: "2026-10-18T14:03:01.000Z",
    time_precision_ms: 0,
    source_health: "HEALTHY",
    raw_source_ref: "SRC-1",
    attributes: {},
    ...p,
  };
}

describe("source configuration", () => {
  it("is consistent with IDP-01 (states and zones)", () => {
    expect(validateSourceConfigAgainstProtocol(sources, protocol)).toEqual([]);
  });
});

describe("bindings", () => {
  it("binds by device for webhooks and never by device name heuristics", () => {
    expect(bindObservation(obs({ source_device_ref: "ring-device-staging" }), sources.bindings).binding?.logical_zone).toBe("staging");
    expect(bindObservation(obs({ source_device_ref: "staging-camera-maybe" }), sources.bindings).binding).toBeUndefined();
  });
  it("binds Playground captures by the operator-declared session zone", () => {
    const b = bindObservation(obs({ source_profile: "RING_PLAYGROUND", attributes: { session_zone: "staging" }, simulation_source: "PACKAGE" }), sources.bindings);
    expect(b.binding?.binding_id).toBe("BIND-PG-STAGING");
  });
  it("does not apply webhook bindings to other profiles", () => {
    expect(bindObservation(obs({ source_profile: "CUSTOM_MEDIA", source_device_ref: "ring-device-staging" }), sources.bindings).binding).toBeUndefined();
  });
});

describe("deterministic-first resolution", () => {
  it("maps configured motion in staging to a STAGING candidate (CONFIGURED_MAPPING)", () => {
    const r = resolveObservation(obs({ logical_zone: "staging", event_subtype: "package_delivery" }), sources, protocol, now);
    expect(r.kind).toBe("CANDIDATE");
    if (r.kind === "CANDIDATE") {
      expect(r.candidate.semantic_state).toBe("staging");
      expect(r.candidate.interpretation_mode).toBe("CONFIGURED_MAPPING");
      expect(r.candidate.candidate_id).toMatch(/^CAN-STAGING-[0-9a-f]{8}$/);
      expect(r.candidate.source_refs[0]!.source_event_ref).toBe("ev-1");
    }
  });
  it("routes unclassified motion to AI interpretation only via an explicit mapping", () => {
    expect(resolveObservation(obs({ logical_zone: "staging", event_subtype: "other_motion" }), sources, protocol, now).kind).toBe("NEEDS_INTERPRETATION");
  });
  it("never turns health events, unknown events or unbound observations into evidence", () => {
    expect(resolveObservation(obs({ family: "INTEGRATION_HEALTH", event_type: "device_offline" }), sources, protocol, now).kind).toBe("NOT_EVIDENCE");
    expect(resolveObservation(obs({ family: "UNKNOWN", event_type: "unknown_future_event", logical_zone: "staging" }), sources, protocol, now).kind).toBe("NOT_EVIDENCE");
    expect(resolveObservation(obs({ event_subtype: "human" }), sources, protocol, now).kind).toBe("UNBOUND");
    expect(resolveObservation(obs({ logical_zone: "staging", event_subtype: "brand_new" }), sources, protocol, now).kind).toBe("NO_MAPPING");
  });
});

describe("acceptance policy", () => {
  const base = resolveObservation(obs({ logical_zone: "staging", event_subtype: "package_delivery" }), sources, protocol, now);
  const c = base.kind === "CANDIDATE" ? base.candidate : (undefined as never);
  it("accepts configured mappings", () => expect(applyAcceptance(c, acceptance).status).toBe("ACCEPTED"));
  it("accepts only SUPPORTED/HIGH AI evidence", () => {
    expect(applyAcceptance({ ...c, interpretation_mode: "AI_ASSISTED", assessment: "SUPPORTED", quality: "HIGH" }, acceptance).status).toBe("ACCEPTED");
    expect(applyAcceptance({ ...c, interpretation_mode: "AI_ASSISTED", assessment: "SUPPORTED", quality: "MEDIUM" }, acceptance).status).toBe("UNCERTAIN");
    expect(applyAcceptance({ ...c, interpretation_mode: "AI_ASSISTED", assessment: "AMBIGUOUS", quality: "HIGH" }, acceptance).status).toBe("UNCERTAIN");
    expect(applyAcceptance({ ...c, interpretation_mode: "AI_ASSISTED", assessment: "NOT_SUPPORTED", quality: "HIGH" }, acceptance).status).toBe("REJECTED");
  });
});

describe("AI evidence interpreter boundary", () => {
  it("output schema has no verdict, release, hold or action fields", () => {
    const schema = JSON.stringify(interpretationJsonSchema(["staging"]));
    for (const forbidden of ["verdict", "release", "hold", "action", "compliant", "sealed"]) expect(schema.toLowerCase()).not.toContain(`"${forbidden}"`);
  });
  it("rejects extra keys instead of repairing them", () => {
    expect(() => validateInterpretationOutput({ candidate_state: "staging", assessment: "SUPPORTED", quality: "HIGH", reason_code: "OTHER", verdict: "SEALED" }, ["staging"])).toThrow(InterpretationSchemaError);
  });
  it("rejects states outside the zone's allowed enum (no protocol extension by AI)", () => {
    expect(() => validateInterpretationOutput({ candidate_state: "loading", assessment: "SUPPORTED", quality: "HIGH", reason_code: "OTHER" }, ["staging"])).toThrow(InterpretationSchemaError);
  });
  it("mock interpreter defaults to AMBIGUOUS/LOW", async () => {
    const r = await new MockEvidenceInterpreter().interpret({ request_id: "x", observation: obs({}), logical_zone: "staging", proposed_state: "staging", allowed_states: ["staging"] });
    expect(r).toMatchObject({ assessment: "AMBIGUOUS", quality: "LOW" });
  });
});

describe("coverage", () => {
  const zones = protocol.zones.map((z) => z.id);
  it("is HEALTHY without outages, UNAVAILABLE during an overlapping outage", () => {
    const base = { zones, bindings: sources.bindings, profiles: ["RING_WEBHOOK" as const], from: "2026-10-18T14:00:00Z", to: "2026-10-18T14:11:00Z" };
    expect(computeCoverage({ ...base, windows: [] }).staging).toBe("HEALTHY");
    const c = computeCoverage({ ...base, windows: [{ source_key: "ring-device-staging", status: "OFFLINE", from: "2026-10-18T14:01:00Z", to: "2026-10-18T14:10:00Z" }] });
    expect(c.staging).toBe("UNAVAILABLE");
    expect(c["receiving-entry"]).toBe("HEALTHY");
  });
  it("is UNKNOWN for a zone with no binding for the profile in use", () => {
    expect(computeCoverage({ zones, bindings: sources.bindings, profiles: ["CUSTOM_MEDIA"], windows: [], from: "2026-10-18T14:00:00Z", to: "2026-10-18T14:01:00Z" }).staging).toBe("UNKNOWN");
  });
});
