import { describe, expect, it } from "vitest";
import { evaluate, evaluateExecution, hashEvidenceSet } from "../src";
import { at, cand, ev, idp01, sequenceA, sequenceB } from "./support";

const protocol = idp01();
const run = (evidence = sequenceA(), extra: Partial<Parameters<typeof evaluateExecution>[0]> = {}) =>
  evaluateExecution({ protocol, evidence, mode: "FINAL", ...extra });
const rule = (r: ReturnType<typeof run>, id: string) => r.rule_results.find((x) => x.rule_id === id)!;

describe("Golden engine tests (Doc 03 §106)", () => {
  it("T01 canonical success → SEALED", () => {
    const r = run();
    expect(r.verdict).toBe("SEALED");
    expect(r.integrity_state).toBe("VERIFIED");
    expect(r.complete).toBe(true);
    expect(r.rule_results.every((x) => x.status === "PASS")).toBe(true);
    expect(r.observed_sequence.map((s) => s.state)).toEqual(["arrival", "staging", "storage", "departure", "clear"]);
  });

  it("T02 wrong order → DEVIATED with ORDER-02 as the only failure", () => {
    const r = run(sequenceB());
    expect(r.verdict).toBe("DEVIATED");
    expect(r.primary_failures).toEqual(["ORDER-02"]);
    expect(r.secondary_failures).toEqual([]);
    expect(rule(r, "ORDER-02").explanation).toBe("STORAGE occurred 3 min before required STAGING.");
    expect(rule(r, "ORDER-02").evidence_refs).toHaveLength(2);
    expect(r.explanation).toContain("ORDER-02");
  });

  it("T03 temporal violation → DEVIATED (TEMP-01)", () => {
    const r = run([ev("arrival", 0), ev("staging", 8), ev("storage", 10), ev("departure", 12), ev("clear", 14)]);
    expect(r.verdict).toBe("DEVIATED");
    expect(r.primary_failures).toEqual(["TEMP-01"]);
  });

  it("T04 missing CLEAR with healthy coverage → INCOMPLETE", () => {
    const r = run(sequenceA().slice(0, 4));
    expect(r.verdict).toBe("INCOMPLETE");
    expect(r.missing_states).toEqual(["clear"]);
    expect(rule(r, "REQ-05")).toMatchObject({ status: "NOT_EVALUABLE", reason: "MISSING_EVIDENCE" });
    expect(r.explanation).toBe("Required CLEAR evidence has not been observed.");
  });

  it("T05 ambiguous STAGING → UNCERTAIN (never SEALED, never DEVIATED)", () => {
    const evidence = sequenceA().filter((e) => e.semantic_state !== "staging");
    const r = run(evidence, { unresolved: [cand("staging", 3)] });
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.unresolved_states).toEqual(["staging"]);
  });

  it("T06 duplicate evidence for the same event does not change the verdict", () => {
    const a = sequenceA();
    expect(run([...a, { ...a[1]!, evidence_id: "EV-DUP" }]).verdict).toBe("SEALED");
  });

  it("T07 evidence input order never matters (occurrence time is authoritative)", () => {
    const a = run(sequenceA());
    const b = run([...sequenceA()].reverse());
    expect(b.verdict).toBe("SEALED");
    expect(JSON.stringify(b.rule_results.map((r) => r.status))).toBe(JSON.stringify(a.rule_results.map((r) => r.status)));
  });

  it("T08 source outage while STAGING expected → UNCERTAIN (not INCOMPLETE)", () => {
    const evidence = sequenceA().filter((e) => e.semantic_state !== "staging");
    const coverage = { "receiving-entry": "HEALTHY", staging: "UNAVAILABLE", "storage-transition": "HEALTHY", "receiving-exit": "HEALTHY" } as const;
    const r = run(evidence, { coverage });
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.uncertainty_items.some((i) => i.kind === "COVERAGE_GAP" && i.state === "staging")).toBe(true);
    // Same evidence, healthy coverage → INCOMPLETE
    expect(run(evidence, { coverage: { ...coverage, staging: "HEALTHY" } }).verdict).toBe("INCOMPLETE");
  });

  it("T09 equal strict timestamps → UNCERTAIN", () => {
    const r = run([ev("arrival", 0), ev("staging", 3), ev("storage", 3), ev("departure", 9), ev("clear", 11)]);
    expect(r.verdict).toBe("UNCERTAIN");
    expect(rule(r, "ORDER-02")).toMatchObject({ status: "NOT_EVALUABLE", reason: "AMBIGUOUS_ORDER" });
  });

  it("T10 unknown-state noise is ignored for protocol semantics", () => {
    expect(run([...sequenceA(), ev("loading-bay", 4)]).verdict).toBe("SEALED");
  });
});

describe("SEQSEAL verification profile details", () => {
  it("SEALED is a positive claim: empty evidence is INCOMPLETE, never SEALED", () => {
    expect(run([]).verdict).toBe("INCOMPLETE");
  });

  it("timestamp precision can make order ambiguous", () => {
    const r = run([ev("arrival", 0), ev("staging", 3, { precision: 30_000 }), ev("storage", 3, { seconds: 20 }), ev("departure", 9), ev("clear", 11)]);
    expect(rule(r, "ORDER-02").reason).toBe("AMBIGUOUS_ORDER");
    expect(r.verdict).toBe("UNCERTAIN");
  });

  it("evidence whose interpretation mode the protocol does not accept is not authoritative", () => {
    const a = sequenceA();
    a[0] = { ...a[0]!, interpretation_mode: "AI_ASSISTED" }; // IDP-01 arrival: DIRECT, CONFIGURED, HUMAN_CONFIRMED
    const r = run(a);
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.uncertainty_items.some((i) => i.kind === "AUTHORITY_NOT_ACCEPTED")).toBe(true);
  });

  it("evidence without provenance never contributes to SEALED", () => {
    const a = sequenceA();
    a[1] = { ...a[1]!, source_refs: [{ provider: "ring", source_profile: "RING_WEBHOOK" }] };
    expect(run(a).verdict).toBe("UNCERTAIN");
  });

  it("an earlier unresolved candidate that could reverse a FAIL contests it (UNCERTAIN, not DEVIATED)", () => {
    const r = run(sequenceB(), { unresolved: [cand("staging", 1)] });
    expect(r.verdict).toBe("UNCERTAIN");
    expect(rule(r, "ORDER-02").explanation_code).toBe("FAIL_CONTESTED");
  });

  it("a later unresolved candidate is immaterial", () => {
    const r = run(sequenceA(), { unresolved: [cand("staging", 5)] });
    expect(r.verdict).toBe("SEALED");
    expect(r.uncertainty_items.every((i) => !i.material)).toBe(true);
  });

  it("correlation ambiguity supplied by correlation is material", () => {
    const r = run(sequenceA(), { ambiguities: [{ kind: "CORRELATION_AMBIGUITY", rule_ids: [], refs: ["CAN-X"], material: true, detail: "second arrival" }] });
    expect(r.verdict).toBe("UNCERTAIN");
  });

  it("provisional mode flags a potential order violation without issuing DEVIATED", () => {
    const r = evaluateExecution({ protocol, evidence: [ev("arrival", 0), ev("storage", 3)], mode: "PROVISIONAL" });
    expect(r.verdict).toBe("INCOMPLETE");
    expect(r.potential_violations).toEqual(["ORDER-02"]);
    expect(r.integrity_state).toBe("POTENTIAL_ORDER_VIOLATION");
  });

  it("a proven violation is DEVIATED even before completion (early HOLD basis)", () => {
    const r = evaluateExecution({ protocol, evidence: [ev("arrival", 0), ev("storage", 3), ev("staging", 6)], mode: "PROVISIONAL" });
    expect(r.verdict).toBe("DEVIATED");
    expect(r.complete).toBe(false);
  });

  it("produces a protocol-derived counterfactual", () => {
    const r = run(sequenceB());
    expect(r.counterfactual).toEqual({
      rule_id: "ORDER-02",
      statement: "If STAGING had occurred before STORAGE, ORDER-02 would have passed.",
      verdict_if_changed: "SEALED",
    });
  });

  it("is deterministic: identical input → identical result and hashes", () => {
    const a = run(sequenceB());
    for (let i = 0; i < 100; i++) {
      const b = run([...sequenceB()].sort(() => 0.5 - Math.random()));
      expect(b.verdict).toBe("DEVIATED");
      expect(b.evidence_set_hash).not.toBe(""); // ids differ per helper call; hash computed
    }
    const fixed = sequenceB();
    const h1 = run(fixed);
    const h2 = run([...fixed].reverse());
    expect(h2.input_hash).toBe(h1.input_hash);
    expect(h2.evidence_set_hash).toBe(hashEvidenceSet(fixed));
    expect(a.verdict).toBe("DEVIATED");
  });

  it("has no clock: occurred_at drives order even if accepted_at is reversed", () => {
    const a = sequenceA().map((e, i) => ({ ...e, accepted_at: at(100 - i) }));
    expect(run(a).verdict).toBe("SEALED");
  });
});

describe("Evidence Graph and engine contract (Master Brief §7, §20)", () => {
  it("evaluate(protocol, evidence) is the FINAL engine contract", () => {
    expect(evaluate(protocol, sequenceA()).verdict).toBe("SEALED");
    expect(evaluate(protocol, sequenceB()).primary_failures).toEqual(["ORDER-02"]);
  });

  it("observed edges follow physical time; protocol edges agree with rule results", () => {
    const g = run(sequenceB()).evidence_graph!;
    expect(g.nodes.filter((n) => n.status === "PRESENT").map((n) => n.state)).toEqual(["arrival", "staging", "storage", "departure", "clear"]);
    expect(g.edges).toHaveLength(10); // every pair of the five present states
    expect(g.edges.find((e) => e.from === "storage" && e.to === "staging")).toMatchObject({ relation: "OBSERVED_BEFORE", delta_ms: 180_000 });
    for (const pe of g.protocol_edges) {
      const r = rule(run(sequenceB()), pe.rule_id);
      expect(pe.status).toBe(r.status);
    }
    expect(g.protocol_edges.find((e) => e.rule_id === "ORDER-02")).toMatchObject({ status: "FAIL", observed: "OBSERVED_AFTER" });
  });

  it("overlapping precision windows make an edge ORDER_UNDETERMINED, never a violation", () => {
    const evidence = [ev("arrival", 0), ev("staging", 3, { precision: 30_000 }), ev("storage", 3, { seconds: 20 }), ev("departure", 9), ev("clear", 11)];
    const r = run(evidence);
    expect(r.verdict).toBe("UNCERTAIN");
    expect(r.evidence_graph!.edges.find((e) => e.from === "staging" && e.to === "storage")?.relation).toBe("ORDER_UNDETERMINED");
    expect(r.evidence_graph!.protocol_edges.find((e) => e.rule_id === "ORDER-02")).toMatchObject({ status: "NOT_EVALUABLE", observed: "ORDER_UNDETERMINED" });
  });

  it("absent and unresolved states are nodes without edges", () => {
    const g = run(sequenceA().filter((e) => e.semantic_state !== "clear"), { unresolved: [cand("clear", 11)] }).evidence_graph!;
    expect(g.nodes.find((n) => n.state === "clear")).toMatchObject({ status: "UNRESOLVED" });
    expect(g.edges.some((e) => e.from === "clear" || e.to === "clear")).toBe(false);
  });
});
