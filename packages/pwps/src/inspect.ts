import type { CompiledProtocol, CompiledRule } from "./compile";
import { humanizeDuration } from "./duration";

const label = (p: CompiledProtocol, id: string) => (p.stateIndex[id]?.label ?? id).toUpperCase();

/** Human-readable one-line description of a compiled rule. */
export function describeRule(p: CompiledProtocol, r: CompiledRule): string {
  switch (r.kind) {
    case "REQUIRED":
      return `${label(p, r.state)} is required`;
    case "PRECEDENCE":
      return `${label(p, r.first)} must occur before ${label(p, r.second)}`;
    case "WITHIN":
      return `${label(p, r.target)} must occur within ${humanizeDuration(r.maxMs)} after ${label(p, r.anchor)}`;
    case "FORBIDDEN_TRANSITION":
      return `${label(p, r.from)} → ${label(p, r.to)} is forbidden`;
    case "FORBIDDEN_STATE":
      return `${label(p, r.state)} must not occur`;
  }
}

export function inspectProtocol(p: CompiledProtocol): string {
  const lines: string[] = [];
  lines.push(`Protocol`, `  ${p.ref}  ${p.name}`, ``);
  lines.push(`Hash`, `  ${p.hash}`, ``);
  lines.push(`Expected sequence`, `  ${p.expectedSequence.map((s) => label(p, s)).join(" → ")}`, ``);
  lines.push(`Required states`, ...p.requiredStates.map((s) => `  ${s}`), ``);
  const groups: Array<[string, CompiledRule["kind"][]]> = [
    ["Requirement constraints", ["REQUIRED"]],
    ["Ordering constraints", ["PRECEDENCE"]],
    ["Temporal constraints", ["WITHIN"]],
    ["Forbidden conditions", ["FORBIDDEN_TRANSITION", "FORBIDDEN_STATE"]],
  ];
  for (const [title, kinds] of groups) {
    const rules = p.rules.filter((r) => kinds.includes(r.kind));
    if (!rules.length) continue;
    lines.push(title);
    for (const r of rules) lines.push(`  ${r.id.padEnd(10)} ${describeRule(p, r)}${r.severity === "ADVISORY" ? "  (advisory)" : ""}`);
    lines.push(``);
  }
  return lines.join("\n");
}
