import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compilePwpsFile } from "@pwps/core";
import { loadActionPolicyFile } from "@seqseal/action-policy-core";
import { loadAcceptancePolicyFile, loadSourceConfigFile, validateSourceConfigAgainstProtocol } from "@seqseal/evidence-model";
import type { PipelineConfig } from "./pipeline";

export interface ConfigPaths {
  protocol: string;
  policy: string;
  sources: string;
  acceptance: string;
}

/**
 * Locate the configuration root: SEQSEAL_CONFIG_DIR (Lambda bundles copy
 * protocols/, policies/ and config/ there), else walk up to the monorepo root.
 */
export function findConfigRoot(start = process.cwd()): string {
  const env = process.env.SEQSEAL_CONFIG_DIR;
  if (env && existsSync(join(env, "protocols"))) return resolve(env);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "protocols", "inbound-delivery.yaml")) && existsSync(join(dir, "policies"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`SEQSEAL configuration not found from ${start}; set SEQSEAL_CONFIG_DIR`);
    dir = parent;
  }
}

export function defaultConfigPaths(root = findConfigRoot()): ConfigPaths {
  return {
    protocol: join(root, "protocols", "inbound-delivery.yaml"),
    policy: join(root, "policies", "inbound-delivery-default.yaml"),
    sources: join(root, "config", "inbound-delivery.sources.yaml"),
    acceptance: join(root, "policies", "evidence-acceptance-default.yaml"),
  };
}

/**
 * Load and validate the active configuration. Any invalid artifact blocks startup:
 * PROTOCOL_INVALID / POLICY_INVALID never fall back to a permissive default.
 */
export function loadPipelineConfig(paths: Partial<ConfigPaths> = {}): PipelineConfig {
  const p = { ...defaultConfigPaths(paths.protocol ? dirname(dirname(paths.protocol)) : undefined), ...paths };
  const protocol = compilePwpsFile(p.protocol);
  const policy = loadActionPolicyFile(p.policy);
  const sources = loadSourceConfigFile(p.sources);
  const acceptance = loadAcceptancePolicyFile(p.acceptance);
  const errors = validateSourceConfigAgainstProtocol(sources, protocol);
  if (errors.length) throw new Error(`Source configuration invalid for ${protocol.ref}: ${errors.join(" ")}`);
  return { protocol, policy, sources, acceptance };
}
