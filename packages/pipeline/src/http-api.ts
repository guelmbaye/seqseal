import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findConfigRoot } from "./config-loader";
import type { PipelineConfig } from "./pipeline";
import type { ReadModel } from "./read-model";
import { replayReceipt } from "./replay-verify";
import type { SeqSealStore } from "./store/repository";

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ScenarioInfo {
  id: string;
  label: string;
  description?: string;
  category?: string;
  events: number;
}

/** Fixture scenarios available to the demo launcher (fixtures/scenarios/*.json). */
export function listScenarios(root = findConfigRoot()): ScenarioInfo[] {
  const dir = join(root, "fixtures", "scenarios");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as { scenario_id: string; label: string; description?: string; category?: string; events: unknown[] };
        return { id: s.scenario_id, label: s.label, ...(s.description ? { description: s.description } : {}), ...(s.category ? { category: s.category } : {}), events: s.events.length };
      })
      .sort((a, b) => order(a.id) - order(b.id));
  } catch {
    return [];
  }
}

const ORDER = ["correct-sequence", "wrong-sequence", "missing-evidence", "ambiguous-evidence"];
const order = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : 99);

export function loadScenario(id: string, root = findConfigRoot()): unknown {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("invalid scenario id");
  return JSON.parse(readFileSync(join(root, "fixtures", "scenarios", `${id}.json`), "utf8"));
}

export interface CaptureSessionInfo {
  id: string;
  captures: number;
  first_captured_at?: string;
  sources: string[];
}

/**
 * Saved Ring Playground capture sessions (fixtures/ring/captures/<id>.jsonl), written by
 * `scripts/ring-spike.ts capture`. Replaying one is a Ring-derived replay, never "live".
 */
export function listCaptureSessions(root = findConfigRoot()): CaptureSessionInfo[] {
  const dir = join(root, "fixtures", "ring", "captures");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => {
        const caps = loadCaptureSession(f.replace(/\.jsonl$/, ""), root) as Array<{ captured_at?: string; simulation_source?: string; session_zone?: string }>;
        return {
          id: f.replace(/\.jsonl$/, ""),
          captures: caps.length,
          ...(caps[0]?.captured_at ? { first_captured_at: caps[0].captured_at } : {}),
          sources: caps.map((c) => `${c.simulation_source ?? "?"}@${c.session_zone ?? "?"}`),
        };
      });
  } catch {
    return [];
  }
}

export function loadCaptureSession(id: string, root = findConfigRoot()): unknown[] {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("invalid capture session id");
  return readFileSync(join(root, "fixtures", "ring", "captures", `${id}.jsonl`), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);
}

/**
 * Framework-agnostic read API shared by the read-api Lambda and the local web backend.
 * Read-only: no route here can change evidence, verdicts or actions.
 */
export async function handleReadApi(
  rm: ReadModel,
  store: SeqSealStore,
  config: PipelineConfig,
  method: string,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<ApiResponse> {
  if (method !== "GET") return { status: 405, body: { error: "method not allowed" } };
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts[0] === "api") parts.shift();
  const limit = Math.min(Number(query.limit ?? 50) || 50, 500);
  const [resource, id, sub] = parts;
  const notFound = { status: 404, body: { error: "not found" } };

  switch (resource) {
    case "status":
      return { status: 200, body: await rm.status() };
    case "protocol":
      if (id === "source") {
        try {
          return { status: 200, body: { format: "yaml", source: readFileSync(join(findConfigRoot(), "protocols", "inbound-delivery.yaml"), "utf8") } };
        } catch {
          return notFound;
        }
      }
      return { status: 200, body: rm.protocol() };
    case "policy":
      return { status: 200, body: rm.policy() };
    case "hero":
      return { status: 200, body: await rm.hero() };
    case "scenarios":
      return { status: 200, body: listScenarios() };
    case "capture-sessions":
      return { status: 200, body: listCaptureSessions() };
    case "executions": {
      if (!id) return { status: 200, body: await rm.listExecutions(limit) };
      const d = await rm.executionDetail(id);
      return d ? { status: 200, body: d } : notFound;
    }
    case "receipts": {
      if (!id) return { status: 200, body: await rm.receipts(limit) };
      const r = await rm.receipt(id);
      if (!r) return notFound;
      if (sub === "replay") return { status: 200, body: await replayReceipt(store, config, r) };
      return { status: 200, body: r };
    }
    case "events":
      return { status: 200, body: await rm.events(limit) };
    case "observations":
      return { status: 200, body: await rm.observations(limit) };
    default:
      return notFound;
  }
}
