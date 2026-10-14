import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compilePwpsFile,
  evaluateRules,
  hashPwps,
  validatePwpsFile,
  type RuleStatus,
  type Timeline,
  type ValidationMode,
} from "../src";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "conformance");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  valid: Array<{ file: string; mode?: ValidationMode; warnings?: string[] }>;
  invalid: Array<{ file: string; mode?: ValidationMode; codes: string[] }>;
  canonical: Array<{ name: string; files: string[]; expected_hash: string }>;
  evaluation: string;
};

describe("PWPS conformance — Level 1/2 (parser + validator): valid documents", () => {
  for (const c of manifest.valid) {
    it(`accepts ${c.file}${c.mode ? ` (${c.mode})` : ""}`, () => {
      const r = validatePwpsFile(join(root, c.file), { mode: c.mode ?? "strict" });
      expect(r.errors).toEqual([]);
      expect(r.valid).toBe(true);
      for (const w of c.warnings ?? []) expect(r.warnings.map((x) => x.code)).toContain(w);
    });
  }
});

describe("PWPS conformance — Level 2: invalid documents are rejected with stable codes", () => {
  for (const c of manifest.invalid) {
    it(`rejects ${c.file} with ${c.codes.join(", ")}`, () => {
      const r = validatePwpsFile(join(root, c.file), { mode: c.mode ?? "strict" });
      expect(r.valid).toBe(false);
      expect(r.document).toBeUndefined();
      const codes = r.errors.map((e) => e.code);
      for (const code of c.codes) expect(codes).toContain(code);
    });
  }
});

describe("PWPS conformance — Level 3: canonicalization and hashing", () => {
  for (const c of manifest.canonical) {
    it(c.name, () => {
      const hashes = c.files.map((f) => {
        const r = validatePwpsFile(join(root, f));
        expect(r.valid, `${f}: ${JSON.stringify(r.errors)}`).toBe(true);
        return hashPwps(r.document!);
      });
      for (const h of hashes) expect(h).toBe(c.expected_hash);
    });
  }
});

describe("PWPS conformance — Level 4: reference rule semantics", () => {
  const evalFile = join(root, manifest.evaluation);
  const cases = JSON.parse(readFileSync(evalFile, "utf8")) as {
    cases: Array<{
      name: string;
      protocol: string;
      timeline: Record<string, unknown>;
      expected: Record<string, RuleStatus>;
      expected_reasons?: Record<string, string>;
    }>;
  };
  for (const c of cases.cases) {
    it(c.name, () => {
      // Protocol paths are relative to the conformance root.
      const protocol = compilePwpsFile(join(root, c.protocol));
      const timeline: Timeline = {};
      for (const [k, v] of Object.entries(c.timeline)) {
        timeline[k] = typeof v === "string" ? { status: "PRESENT", at: Date.parse(v) } : (v as Timeline[string]);
      }
      const results = evaluateRules(protocol, timeline);
      const byId = Object.fromEntries(results.map((r) => [r.rule_id, r]));
      for (const [id, status] of Object.entries(c.expected)) expect(byId[id]?.status, id).toBe(status);
      for (const [id, reason] of Object.entries(c.expected_reasons ?? {})) expect(byId[id]?.reason, id).toBe(reason);
    });
  }
});
