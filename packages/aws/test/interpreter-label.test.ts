import { describe, expect, it } from "vitest";
import { DisabledEvidenceInterpreter, MockEvidenceInterpreter, type EvidenceInterpreter } from "@seqseal/evidence-model";
import { interpreterLabel } from "../src";

describe("System page interpreter label on AWS", () => {
  it("says when no Bedrock call is made, as the local console does", () => {
    expect(interpreterLabel(new MockEvidenceInterpreter())).toBe("mock-evidence-interpreter@1 (fixture hints, no Bedrock call)");
    expect(interpreterLabel(new DisabledEvidenceInterpreter())).toBe("no evidence interpreter (no Bedrock call)");
  });
  it("shows a model-backed interpreter by its own id", () => {
    const bedrock = { id: "bedrock:amazon.nova-lite-v1:0", interpret: async () => ({}) } as unknown as EvidenceInterpreter;
    expect(interpreterLabel(bedrock)).toBe("bedrock:amazon.nova-lite-v1:0");
  });
});
