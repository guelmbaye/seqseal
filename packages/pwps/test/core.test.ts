import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  compilePwps,
  compilePwpsFile,
  formatDuration,
  hashPwps,
  parseDuration,
  PwpsValidationError,
  validatePwps,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const examples = join(here, "..", "examples");

describe("durations", () => {
  it.each([
    ["PT5M", 300_000],
    ["PT300S", 300_000],
    ["PT1H30M", 5_400_000],
    ["P1DT2H", 93_600_000],
    ["PT0.5S", 500],
  ])("parses %s", (s, ms) => expect(parseDuration(s)).toBe(ms));

  it.each(["P1M", "P1Y", "5 minutes", "PT", "P", "-PT5M", "PT5.1234S"])("rejects %s", (s) => expect(parseDuration(s)).toBeNull());

  it("formats canonically", () => {
    expect(formatDuration(420_000)).toBe("PT7M");
    expect(formatDuration(93_600_000)).toBe("P1DT2H");
    expect(formatDuration(1_500)).toBe("PT1.5S");
  });
});

describe("canonical JSON", () => {
  it("sorts keys, drops undefined, preserves arrays", () => {
    expect(canonicalJson({ b: 1, a: [3, 1, { d: undefined, c: true }] })).toBe('{"a":[3,1,{"c":true}],"b":1}');
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });
});

describe("compiler", () => {
  const idp = compilePwpsFile(join(examples, "inbound-delivery.yaml"));

  it("derives the expected sequence from precedence constraints", () => {
    expect(idp.expectedSequence).toEqual(["arrival", "staging", "storage", "departure", "clear"]);
    expect(idp.openingState).toBe("arrival");
    expect(idp.terminalStates).toEqual(["clear"]);
    expect(idp.requiredStates).toHaveLength(5);
  });

  it("normalizes BEFORE/AFTER into precedence and WITHIN into bounds", () => {
    const order02 = idp.rules.find((r) => r.id === "ORDER-02")!;
    expect(order02).toMatchObject({ kind: "PRECEDENCE", first: "staging", second: "storage" });
    const temp01 = idp.rules.find((r) => r.id === "TEMP-01")!;
    expect(temp01).toMatchObject({ kind: "WITHIN", anchor: "arrival", target: "staging", maxMs: 420_000 });
  });

  it("synthesizes implicit REQUIRED rules for required states without constraints", () => {
    const p = compilePwpsFile(join(here, "..", "conformance", "valid", "implicit-required.yaml"));
    expect(p.rules.filter((r) => r.kind === "REQUIRED").map((r) => r.id)).toEqual(["REQ:start", "REQ:finish"]);
  });

  it("is deterministic: same document → same hash, same graph", () => {
    const again = compilePwpsFile(join(examples, "inbound-delivery.yaml"));
    expect(again.hash).toBe(idp.hash);
    expect(JSON.stringify(again.rules)).toBe(JSON.stringify(idp.rules));
  });

  it("throws PwpsValidationError instead of silently skipping an invalid rule", () => {
    const bad = `pwps: "0.1"\nprotocol: {id: X, version: 1.0.0, name: X}\nstates: [{id: a}]\nconstraints: [{id: R, operator: BEFORE, state: a, reference: missing}]`;
    expect(() => compilePwps(bad)).toThrow(PwpsValidationError);
  });

  it("changes the hash when semantics change", () => {
    const base = validatePwps(`pwps: "0.1"\nprotocol: {id: X, version: 1.0.0, name: X}\nstates: [{id: a, terminal: true}, {id: b}]\nconstraints: [{id: R, operator: BEFORE, state: a, reference: b}]`);
    const flipped = validatePwps(`pwps: "0.1"\nprotocol: {id: X, version: 1.0.0, name: X}\nstates: [{id: a, terminal: true}, {id: b}]\nconstraints: [{id: R, operator: BEFORE, state: b, reference: a}]`);
    expect(hashPwps(base.document!)).not.toBe(hashPwps(flipped.document!));
  });
});

describe("parser security limits", () => {
  it("rejects oversized documents", () => {
    const r = validatePwps("a".repeat(2048), { maxBytes: 1024 });
    expect(r.errors[0]?.code).toBe("PWPS-E070");
  });
  it("rejects excessive nesting", () => {
    const deep = "x: " + "[".repeat(40) + "]".repeat(40);
    const r = validatePwps(deep, { maxDepth: 32 });
    expect(r.errors[0]?.code).toBe("PWPS-E070");
  });
  it("rejects YAML alias bombs", () => {
    const bomb = ["a: &a [x,x,x,x,x,x,x,x,x,x]", ...Array.from({ length: 12 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(10).fill(`*${String.fromCharCode(97 + i)}`).join(",")}]`)].join("\n");
    const r = validatePwps(bomb);
    expect(r.valid).toBe(false);
  });
});

describe("CLI", () => {
  const cli = join(here, "..", "src", "cli.ts");
  // `node --import tsx` resolves tsx from the working directory: the package's own clone or the monorepo root.
  const run = (...args: string[]) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }) };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };

  it("validates IDP-01 and prints its identity", () => {
    const r = run("validate", join(examples, "inbound-delivery.yaml"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ PWPS 0.1 valid");
    expect(r.out).toContain("Protocol: IDP-01@1.0.0");
  });

  it("explains ORDER-02 failure for the wrong-order timeline", () => {
    const r = run("eval", join(examples, "inbound-delivery.yaml"), join(examples, "timeline-wrong-order.json"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ORDER-02\s+FAIL/);
  });

  it("exits 1 with a stable code for an invalid document", () => {
    const r = run("validate", join(here, "..", "conformance", "invalid", "unknown-reference.yaml"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("PWPS-E021");
  });
});
