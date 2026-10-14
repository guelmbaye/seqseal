import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERDICTS, type Verdict, type WorkflowEvaluation } from "@seqseal/contracts";
import { decide, loadActionPolicy, loadActionPolicyFile, ReleaseInvariantViolation, validateActionPolicy } from "../src";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const policy = loadActionPolicyFile(join(root, "policies", "inbound-delivery-default.yaml"));

function evaluation(verdict: Verdict, mode: "FINAL" | "PROVISIONAL" = "FINAL", seq = 3): WorkflowEvaluation {
  return {
    evaluation_id: `EVAL-0043-0${seq}`,
    execution_id: "EXEC-0043",
    seq,
    evaluated_at: "2026-10-18T14:11:00.000Z",
    trigger: "test",
    correlation_id: "COR-test",
    engine_version: "seqseal-engine@0.1.0",
    protocol_ref: "IDP-01@1.0.0",
    protocol_hash: "sha256:x",
    evidence_set_hash: "sha256:y",
    input_hash: "sha256:z",
    mode,
    expected_sequence: [],
    observed_sequence: [],
    rule_results: [],
    missing_states: [],
    unresolved_states: [],
    uncertainty_items: [],
    primary_failures: verdict === "DEVIATED" ? ["ORDER-02"] : [],
    secondary_failures: [],
    potential_violations: [],
    verdict,
    integrity_state: "VERIFIED",
    complete: true,
    explanation: "test",
  };
}

const now = "2026-10-18T14:11:01.000Z";

describe("Golden action tests (Doc 03 §107)", () => {
  it.each([
    ["A01", "SEALED", "RELEASE"],
    ["A02", "DEVIATED", "HOLD"],
    ["A03", "INCOMPLETE", "WAIT"],
    ["A04", "UNCERTAIN", "REVIEW"],
  ] as const)("%s %s + policy v1 → %s", (_id, verdict, action) => {
    const out = decide({ evaluation: evaluation(verdict), policy, now });
    expect(out.kind).toBe("DECISION");
    if (out.kind === "DECISION") {
      expect(out.decision.action).toBe(action);
      expect(out.decision.action_policy_version).toBe("1.0.0");
      expect(out.decision.action_policy_hash).toBe(policy.hash);
      expect(out.decision.decision_id).toBe("DEC-0043-03");
    }
  });

  it("A05 same evaluation + same policy → identical decision identity (idempotent)", () => {
    const a = decide({ evaluation: evaluation("DEVIATED"), policy, now });
    const b = decide({ evaluation: evaluation("DEVIATED"), policy, now: "2026-10-18T15:00:00.000Z" });
    expect(a.kind === "DECISION" && b.kind === "DECISION" && a.decision.idempotency_key === b.decision.idempotency_key).toBe(true);
  });

  it("A06 invalid action policy is rejected at activation", () => {
    expect(validateActionPolicy({ id: "X", name: "x", version: "1.0.0", profile: "safe-mvp", mappings: { SEALED: "RELEASE" } }).valid).toBe(false);
    expect(validateActionPolicy({ id: "X", name: "x", version: "1.0.0", profile: "safe-mvp", mappings: { SEALED: "RELEASE", DEVIATED: "SHRUG", INCOMPLETE: "WAIT", UNCERTAIN: "REVIEW" } }).valid).toBe(false);
  });

  it("A07 DEVIATED → RELEASE is rejected under the safe profile", () => {
    const r = validateActionPolicy(JSON.parse(JSON.stringify({ ...policyDoc(), mappings: { SEALED: "RELEASE", DEVIATED: "RELEASE", INCOMPLETE: "WAIT", UNCERTAIN: "REVIEW" } })));
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toContain("only SEALED may RELEASE");
    expect(() => loadActionPolicy(readFileSync(join(root, "policies", "examples", "invalid-deviated-release.yaml"), "utf8"))).toThrow(/POLICY_INVALID/);
  });
});

describe("Release invariant", () => {
  it("only SEALED can map to RELEASE in every valid policy", () => {
    for (const verdict of VERDICTS) {
      for (const p of [policy, loadActionPolicyFile(join(root, "policies", "examples", "deviated-to-review.yaml"))]) {
        if (p.mappings[verdict] === "RELEASE") expect(verdict).toBe("SEALED");
      }
    }
  });

  it("RELEASE is never applied provisionally (deferred until finalization)", () => {
    const out = decide({ evaluation: evaluation("SEALED", "PROVISIONAL"), policy, now });
    expect(out.kind).toBe("DEFERRED");
  });

  it("HOLD may be applied provisionally (proven deviation cannot be repaired)", () => {
    const out = decide({ evaluation: evaluation("DEVIATED", "PROVISIONAL"), policy, now });
    expect(out.kind === "DECISION" && out.decision.action === "HOLD" && !out.decision.final).toBe(true);
  });

  it("the defensive guard throws even if a corrupted policy object reaches decide()", () => {
    const corrupted = { ...policy, mappings: { ...policy.mappings, UNCERTAIN: "RELEASE" as const } };
    expect(() => decide({ evaluation: evaluation("UNCERTAIN"), policy: corrupted, now })).toThrow(ReleaseInvariantViolation);
  });

  it("policy changes do not alter verdict semantics — same verdict, different governed action", () => {
    const v2 = loadActionPolicyFile(join(root, "policies", "examples", "deviated-to-review.yaml"));
    const out = decide({ evaluation: evaluation("DEVIATED"), policy: v2, now });
    expect(out.kind === "DECISION" && out.decision.verdict === "DEVIATED" && out.decision.action === "REVIEW").toBe(true);
    expect(v2.hash).not.toBe(policy.hash);
  });
});

function policyDoc() {
  return { id: "IDP-ACTION", name: "x", version: "1.0.0", profile: "safe-mvp", mappings: policy.mappings, provisional_actions: ["WAIT"] };
}
