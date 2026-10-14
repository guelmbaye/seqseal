import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Assessment, EvidenceMappingRule, InterpretationMode, Quality, SourceBinding, hashCanonical } from "@seqseal/contracts";

export const SourceConfig = z.object({
  version: z.string(),
  lane: z.string(),
  protocol: z.string(),
  bindings: z.array(SourceBinding).min(1),
  mappings: z.array(EvidenceMappingRule).min(1),
});
export type SourceConfig = z.infer<typeof SourceConfig> & { hash: string };

export function loadSourceConfig(source: string): SourceConfig {
  const parsed = SourceConfig.parse(parseYaml(source, { schema: "core", uniqueKeys: true }));
  const ids = new Set<string>();
  for (const b of parsed.bindings) {
    if (ids.has(b.binding_id)) throw new Error(`Duplicate binding_id ${b.binding_id}`);
    ids.add(b.binding_id);
  }
  for (const m of parsed.mappings) {
    if (ids.has(m.mapping_id)) throw new Error(`Duplicate mapping_id ${m.mapping_id}`);
    ids.add(m.mapping_id);
  }
  return { ...parsed, hash: hashCanonical(parsed) };
}

export function loadSourceConfigFile(path: string): SourceConfig {
  return loadSourceConfig(readFileSync(path, "utf8"));
}

const AcceptanceRule = z.object({
  id: z.string(),
  description: z.string().optional(),
  when: z.object({
    mode: InterpretationMode,
    assessment: z.array(Assessment).optional(),
    quality: z.array(Quality).optional(),
  }),
  outcome: z.enum(["ACCEPT", "UNCERTAIN", "REJECT"]),
});

export const AcceptancePolicyDoc = z.object({
  id: z.string(),
  version: z.string(),
  rules: z.array(AcceptanceRule).min(1),
  default: z.enum(["UNCERTAIN", "REJECT"]),
});
export type AcceptancePolicy = z.infer<typeof AcceptancePolicyDoc> & { hash: string };

export function loadAcceptancePolicy(source: string): AcceptancePolicy {
  const parsed = AcceptancePolicyDoc.parse(parseYaml(source, { schema: "core", uniqueKeys: true }));
  return { ...parsed, hash: hashCanonical(parsed) };
}

export function loadAcceptancePolicyFile(path: string): AcceptancePolicy {
  return loadAcceptancePolicy(readFileSync(path, "utf8"));
}
