import { beforeEach, describe, expect, it, vi } from "vitest";

// Count every Secrets Manager call, and simulate a secret whose container has no value yet.
const sent: string[] = [];
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  GetSecretValueCommand: class {
    constructor(readonly input: { SecretId: string }) {}
  },
  SecretsManagerClient: class {
    async send(cmd: { input: { SecretId: string } }) {
      sent.push(cmd.input.SecretId);
      if (cmd.input.SecretId.endsWith("unset")) throw Object.assign(new Error("no AWSCURRENT"), { name: "ResourceNotFoundException" });
      if (cmd.input.SecretId.endsWith("denied")) throw Object.assign(new Error("denied"), { name: "AccessDeniedException" });
      return { SecretString: `value-of-${cmd.input.SecretId}` };
    }
  },
}));

const { awsRuntime, getSecret } = await import("../src");

describe("secrets on AWS", () => {
  beforeEach(() => {
    sent.length = 0;
    Object.assign(process.env, {
      SEQSEAL_TABLE_EXECUTIONS: "ex",
      SEQSEAL_TABLE_EVIDENCE: "ev",
      SEQSEAL_TABLE_CONFIG: "cfg",
      SEQSEAL_TABLE_IDEMPOTENCY: "idem",
      SEQSEAL_ARTIFACT_BUCKET: "bucket",
      RING_SIGNING_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:1:secret:seqseal-demo/ring-webhook-signing-secret",
    });
  });

  it("only ring-ingest reads the webhook signing secret; every other function starts without it", async () => {
    for (const fn of ["read-api", "review-api", "demo-orchestrator", "execution-sweeper", "sequence-evaluator", "ring-playground-adapter"]) {
      const rt = await awsRuntime(fn);
      expect(rt.pipeline.options.ringSigningSecret, fn).toBeUndefined();
    }
    expect(sent).toEqual([]);
    const ingest = await awsRuntime("ring-ingest", { ringSigningSecret: true });
    expect(sent).toEqual([process.env.RING_SIGNING_SECRET_ARN]);
    expect(ingest.pipeline.options.ringSigningSecret).toBe(`value-of-${process.env.RING_SIGNING_SECRET_ARN}`);
  });

  it("a secret with no value yet reads as not configured, so callers fail closed", async () => {
    await expect(getSecret("arn:aws:secretsmanager:us-east-1:1:secret:seqseal-demo/demo-token-unset")).resolves.toBe("");
  });

  it("an access error is a deployment fault and is not hidden", async () => {
    await expect(getSecret("arn:aws:secretsmanager:us-east-1:1:secret:seqseal-demo/demo-token-denied")).rejects.toThrow("denied");
  });
});
