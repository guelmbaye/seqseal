#!/usr/bin/env node
/**
 * pwps — command-line interface for PWPS 0.1.
 *
 *   pwps validate <file...> [--compatible] [--json]
 *   pwps inspect <file>
 *   pwps hash <file>
 *   pwps canonicalize <file>
 *   pwps compile <file>
 *   pwps eval <protocol> <timeline.json> [--json]
 */
import { readFileSync } from "node:fs";
import { compileDocument } from "./compile";
import { canonicalizePwps } from "./canonicalize";
import { formatIssue } from "./errors";
import { evaluateRules, observedSequence, type StateObservation, type Timeline } from "./evaluate";
import { hashPwps } from "./hash";
import { describeRule, inspectProtocol } from "./inspect";
import { PWPS_SPEC_VERSION } from "./types";
import { validatePwpsFile, type ValidationResult } from "./validate";

const VERSION = "0.1.0";
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const green = c(32);
const red = c(31);
const yellow = c(33);
const dim = c(2);
const bold = c(1);

function usage(): string {
  return `pwps ${VERSION} — Physical Workflow Protocol Specification ${PWPS_SPEC_VERSION}

Usage:
  pwps validate <file...> [--compatible] [--json]   Validate structure and semantics
  pwps inspect <file>                               Summarize states and constraints
  pwps hash <file>                                  Print the canonical SHA-256 protocol hash
  pwps canonicalize <file>                          Print canonical JSON
  pwps compile <file>                               Print the compiled protocol graph (JSON)
  pwps eval <protocol> <timeline.json> [--json]     Evaluate rules against an observed timeline

Exit codes: 0 success · 1 invalid document / failed rules · 2 usage error`;
}

function loadValid(file: string, compatible: boolean): ValidationResult & { source: string } {
  const result = validatePwpsFile(file, { mode: compatible ? "compatible" : "strict" });
  if (!result.valid) {
    console.error(red(`✕ INVALID  ${file}`));
    for (const e of result.errors) console.error(`\n${formatIssue(e)}`);
    process.exit(1);
  }
  return result;
}

function parseTimeline(file: string): Timeline {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const timeline: Timeline = {};
  for (const [state, v] of Object.entries(raw)) {
    if (typeof v === "string" || typeof v === "number") {
      const at = typeof v === "number" ? v : Date.parse(v);
      if (Number.isNaN(at)) throw new Error(`Invalid timestamp for "${state}": ${String(v)}`);
      timeline[state] = { status: "PRESENT", at };
    } else if (v && typeof v === "object") {
      const o = v as { status?: string; at?: string | number; reason?: string; precision_ms?: number };
      if (o.status === "ABSENT") timeline[state] = { status: "ABSENT" };
      else if (o.status === "UNRESOLVED") {
        timeline[state] = { status: "UNRESOLVED", reason: (o.reason as "UNRESOLVED_EVIDENCE") ?? "UNRESOLVED_EVIDENCE" };
      } else {
        const at = typeof o.at === "number" ? o.at : Date.parse(String(o.at));
        timeline[state] = { status: "PRESENT", at, ...(o.precision_ms ? { precisionMs: o.precision_ms } : {}) } as StateObservation;
      }
    }
  }
  return timeline;
}

function main(argv: string[]): number {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [cmd, ...files] = args;
  const compatible = flags.has("--compatible");
  const json = flags.has("--json");

  if (!cmd || cmd === "help" || flags.has("--help")) {
    console.log(usage());
    return cmd ? 0 : 2;
  }
  if (flags.has("--version") || cmd === "version") {
    console.log(VERSION);
    return 0;
  }

  switch (cmd) {
    case "validate": {
      if (!files.length) return usageError("validate requires at least one file");
      let failed = 0;
      const reports: unknown[] = [];
      for (const file of files) {
        const r = validatePwpsFile(file, { mode: compatible ? "compatible" : "strict" });
        if (json) {
          reports.push({ file, valid: r.valid, errors: r.errors, warnings: r.warnings, hash: r.document ? hashPwps(r.document) : null });
          if (!r.valid) failed++;
          continue;
        }
        if (!r.valid) {
          failed++;
          console.log(red(`✕ INVALID  ${file}`));
          for (const e of r.errors) console.log(`\n${formatIssue(e)}`);
          console.log("");
          continue;
        }
        const doc = r.document!;
        const compiled = compileDocument(doc);
        console.log(green(`✓ PWPS ${doc.pwps} valid`) + dim(`  ${file}`));
        console.log(`Protocol: ${bold(compiled.ref)}`);
        console.log(`States: ${doc.states.length}`);
        console.log(`Constraints: ${doc.constraints.length}`);
        console.log(`Hash: ${compiled.hash}`);
        for (const w of r.warnings) console.log(yellow(`  ⚠ ${w.code} ${w.message}`));
        console.log("");
      }
      if (json) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
      return failed ? 1 : 0;
    }
    case "inspect": {
      const r = loadValid(need(files[0]), compatible);
      console.log(inspectProtocol(compileDocument(r.document!)));
      return 0;
    }
    case "hash": {
      const r = loadValid(need(files[0]), compatible);
      console.log(hashPwps(r.document!));
      return 0;
    }
    case "canonicalize": {
      const r = loadValid(need(files[0]), compatible);
      console.log(canonicalizePwps(r.document!));
      return 0;
    }
    case "compile": {
      const r = loadValid(need(files[0]), compatible);
      const { document: _d, stateIndex: _s, ...compiled } = compileDocument(r.document!);
      console.log(JSON.stringify(compiled, null, 2));
      return 0;
    }
    case "eval": {
      const r = loadValid(need(files[0]), compatible);
      const protocol = compileDocument(r.document!);
      const timeline = parseTimeline(need(files[1]));
      const results = evaluateRules(protocol, timeline);
      if (json) {
        console.log(JSON.stringify({ protocol: protocol.ref, hash: protocol.hash, observed: observedSequence(protocol, timeline), results }, null, 2));
      } else {
        const lbl = (s: string) => (protocol.stateIndex[s]?.label ?? s).toUpperCase();
        console.log(`Protocol  ${protocol.ref}`);
        console.log(`Expected  ${protocol.expectedSequence.map(lbl).join(" → ")}`);
        console.log(`Observed  ${observedSequence(protocol, timeline).map(lbl).join(" → ")}\n`);
        for (const res of results) {
          const rule = protocol.rules.find((x) => x.id === res.rule_id)!;
          const status =
            res.status === "PASS" ? green("PASS") : res.status === "FAIL" ? red("FAIL") : yellow(res.status);
          console.log(`  ${res.rule_id.padEnd(10)} ${status.padEnd(useColor ? 22 : 13)} ${describeRule(protocol, rule)}${res.reason ? dim(`  [${res.reason}]`) : ""}`);
        }
      }
      return results.some((x) => x.status === "FAIL") ? 1 : 0;
    }
    default:
      return usageError(`unknown command "${cmd}"`);
  }
}

function need(v: string | undefined): string {
  if (!v) {
    usageError("missing file argument");
    process.exit(2);
  }
  return v;
}

function usageError(msg: string): number {
  console.error(red(`error: ${msg}`));
  console.error(usage());
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(red(`error: ${err instanceof Error ? err.message : String(err)}`));
  process.exitCode = 2;
}
