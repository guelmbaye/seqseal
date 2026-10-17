import "server-only";
import {
  handleReadApi,
  listCaptureSessions,
  listScenarios,
  LocalRuntime,
  loadCaptureSession,
  loadScenario,
  ReadModel,
  type ApiResponse,
} from "@seqseal/pipeline";

/**
 * Web backend.
 *   SEQSEAL_BACKEND=local  (default) — the full pipeline runs in-process: same engines,
 *                                      same policy, same gate, in-memory tables.
 *   SEQSEAL_BACKEND=remote — every call is proxied to the deployed AWS read/demo APIs.
 */
const mode = process.env.SEQSEAL_BACKEND === "remote" ? "remote" : "local";
const remoteUrl = (process.env.SEQSEAL_API_URL ?? "").replace(/\/$/, "");
const demoToken = process.env.SEQSEAL_DEMO_TOKEN ?? "";
const PACE_MS = Number(process.env.SEQSEAL_DEMO_PACE_MS ?? 700);

interface Local {
  rt: LocalRuntime;
  rm: ReadModel;
}
const g = globalThis as unknown as { __seqseal?: Local };

function local(): Local {
  if (!g.__seqseal) {
    const rt = new LocalRuntime();
    const rm = new ReadModel(rt.store, rt.pipeline.config, {
      backend: "local (in-process pipeline)",
      interpreter: "mock-evidence-interpreter@1 (fixture hints, no Bedrock call)",
      flags: { ENABLE_BEDROCK_EVIDENCE: false, DEMO_MODE: true },
    });
    g.__seqseal = { rt, rm };
  }
  return g.__seqseal;
}

export const backendMode = mode;

async function proxy(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  if (!remoteUrl) return { status: 503, body: { error: "SEQSEAL_API_URL is not configured for remote mode" } };
  const res = await fetch(`${remoteUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(method !== "GET" ? { "x-seqseal-demo-token": demoToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  return { status: res.status, body: await res.json().catch(() => ({ error: `HTTP ${res.status}` })) };
}

export async function readApi(path: string, query: Record<string, string>): Promise<ApiResponse> {
  if (mode === "remote") return proxy("GET", `${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ""}`);
  const { rt, rm } = local();
  if (path.replace(/\/+$/, "") === "/api/status") {
    const r = await handleReadApi(rm, rt.store, rt.pipeline.config, "GET", path, query);
    return { status: r.status, body: { ...(r.body as object), mode } };
  }
  return handleReadApi(rm, rt.store, rt.pipeline.config, "GET", path, query);
}

/** Launch fixture replays in the background so the UI can watch executions progress. */
function launch(scenarioId: string, runId: string, delayMs = PACE_MS) {
  const { rt } = local();
  void rt.runScenario(loadScenario(scenarioId), { runId, delayMs }).catch((err) => console.error("[seqseal] replay failed", err));
}

const newRunId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export async function demoAction(action: string, body: Record<string, unknown>): Promise<ApiResponse> {
  if (mode === "remote") return proxy("POST", `/api/demo/${action}`, body);
  const { rt } = local();
  switch (action) {
    case "run": {
      const scenario = String(body.scenario ?? "");
      if (!listScenarios().some((s) => s.id === scenario)) return { status: 400, body: { error: `Unknown scenario "${scenario}"` } };
      const runId = newRunId(scenario);
      launch(scenario, runId);
      return { status: 202, body: { runs: [{ run_id: runId, scenario_id: scenario }] } };
    }
    case "winning-moment": {
      const a = newRunId("A");
      const b = newRunId("B");
      // Two isolated replay lanes, same source profile, same mappings, same protocol and policy.
      launch("correct-sequence", a);
      setTimeout(() => launch("wrong-sequence", b), 250);
      return { status: 202, body: { runs: [{ run_id: a, scenario_id: "correct-sequence" }, { run_id: b, scenario_id: "wrong-sequence" }] } };
    }
    case "run-captures": {
      // Ring-derived replay of a saved Playground session (demo fallback level 2).
      const session = String(body.session ?? "");
      if (!listCaptureSessions().some((x) => x.id === session)) return { status: 400, body: { error: `Unknown capture session "${session}"` } };
      const runId = newRunId("rdr");
      void rt.runCaptures(loadCaptureSession(session), { runId, session, delayMs: PACE_MS }).catch((err) => console.error("[seqseal] ring-derived replay failed", err));
      return { status: 202, body: { runs: [{ run_id: runId, scenario_id: `ring-derived:${session}` }] } };
    }
    case "finalize": {
      const id = String(body.execution_id ?? "");
      await rt.finalize(id, "OPERATOR_CLOSE");
      return { status: 202, body: { finalized: id } };
    }
    case "reset":
      g.__seqseal = undefined;
      return { status: 200, body: { reset: true, note: "Local in-memory demo state cleared." } };
    default:
      return { status: 404, body: { error: "unknown demo action" } };
  }
}

export async function reviewAction(body: Record<string, unknown>): Promise<ApiResponse> {
  if (mode === "remote") return proxy("POST", "/api/reviews", body);
  const action = String(body.action ?? "");
  if (!["CONFIRM", "REJECT", "LEAVE_UNRESOLVED"].includes(action)) return { status: 400, body: { error: "action must be CONFIRM, REJECT or LEAVE_UNRESOLVED" } };
  try {
    const review = await local().rt.review({
      candidate_id: String(body.candidate_id ?? ""),
      action: action as "CONFIRM" | "REJECT" | "LEAVE_UNRESOLVED",
      reviewer_ref: String(body.reviewer_ref ?? "operator"),
      ...(body.rationale ? { rationale: String(body.rationale) } : {}),
    });
    return { status: 202, body: { review } };
  } catch (err) {
    return { status: 409, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/** Local webhook endpoint (signature verified with RING_WEBHOOK_SIGNING_SECRET). */
export async function localWebhook(rawBody: string, headers: Record<string, string>): Promise<ApiResponse> {
  if (mode === "remote") return { status: 404, body: { error: "Use the deployed API Gateway webhook URL in remote mode" } };
  const r = await local().rt.ingestWebhook({ rawBody, headers, profile: "RING_WEBHOOK" });
  return { status: r.status, body: r };
}

/**
 * Playground capture endpoint. `x-seqseal-source-profile: RING_DERIVED_REPLAY` marks a capture
 * replayed from a saved session (scripts/replay.ts --captures); anything else is a live capture.
 */
export async function localPlaygroundCapture(capture: unknown, headers: Record<string, string> = {}): Promise<ApiResponse> {
  if (mode === "remote") return proxy("POST", "/integrations/ring/playground/capture", capture);
  const derived = headers["x-seqseal-source-profile"] === "RING_DERIVED_REPLAY";
  const run = headers["x-seqseal-replay-run"];
  const replay = derived && run ? { run_id: run, scenario_id: "ring-derived:remote", label: "Ring-derived replay" } : undefined;
  const r = await local().rt.ingestPlaygroundCapture(capture, replay, derived ? "RING_DERIVED_REPLAY" : "RING_PLAYGROUND");
  return { status: r.status, body: r };
}
