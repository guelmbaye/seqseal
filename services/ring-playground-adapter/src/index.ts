/**
 * ring-playground-adapter — POST /integrations/ring/playground/capture
 *
 * Turns an actual Ring Developer Platform / Playground API interaction into a
 * provenance-carrying capture (Doc 04 §38–46). Two modes:
 *
 *   1. { mode: "probe" | "snapshot", device_id, simulation_source, session_zone, component_id? }
 *      → this Lambda calls the Ring API itself (status probe or image snapshot download),
 *        records method/endpoint/HTTP status/request id as api_evidence, stores the
 *        snapshot under media/<observation> for optional AI interpretation, and ingests.
 *   2. A complete PlaygroundCapture produced by `scripts/ring-spike.ts capture` (live), or replayed
 *      from a saved session with `x-seqseal-source-profile: RING_DERIVED_REPLAY`
 *      (e.g. after a WHEP live-view session from a laptop) → validated and ingested.
 *
 * It never fabricates `motion_detected.package_delivery`: the observation type is
 * `live_view_simulation`, the zone is the one the operator declared for the session.
 */
import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { awsRuntime, getSecret, json, rawBody, requireDemoToken } from "@seqseal/aws";
import { observationIdFor, eventIdempotencyKey, PlaygroundCapture, RingApiClient, RingApiError } from "@seqseal/ring-adapter";
import { z } from "zod";

const CaptureRequest = z.object({
  mode: z.enum(["probe", "snapshot"]),
  device_id: z.string().min(1),
  component_id: z.string().optional(),
  simulation_source: z.enum(["PACKAGE", "VEHICLE", "MOTION"]),
  session_zone: z.string().min(1),
  operator_note: z.string().optional(),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const denied = await requireDemoToken(event);
  if (denied) return denied;
  const rt = await awsRuntime("ring-playground-adapter");
  let body: unknown;
  try {
    body = JSON.parse(rawBody(event) || "{}");
  } catch {
    return json(400, { error: "Body must be JSON" });
  }

  const asCapture = PlaygroundCapture.safeParse(body);
  if (asCapture.success) {
    // A saved capture replayed later (scripts/replay.ts --captures) is labelled RING_DERIVED_REPLAY, never live.
    const header = (name: string) => Object.entries(event.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
    const derived = header("x-seqseal-source-profile") === "RING_DERIVED_REPLAY";
    const run = header("x-seqseal-replay-run");
    const replay = derived && run ? { run_id: run, scenario_id: "ring-derived:remote", label: "Ring-derived replay" } : undefined;
    const r = await rt.pipeline.ingestPlaygroundCapture(asCapture.data, replay, derived ? "RING_DERIVED_REPLAY" : "RING_PLAYGROUND");
    return json(r.status, r);
  }

  const req = CaptureRequest.safeParse(body);
  if (!req.success) return json(400, { error: req.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  const token = await getSecret(process.env.RING_API_TOKEN_SECRET_ARN);
  if (!token) return json(503, { error: "Ring API token not configured (secret ring-api-token)" });

  const ring = new RingApiClient({ baseUrl: process.env.RING_API_BASE_URL ?? "https://api.amazonvision.com", accessToken: token });
  const captureId = `pg-${randomUUID()}`;
  const capturedAt = new Date().toISOString();
  try {
    const call =
      req.data.mode === "snapshot"
        ? await ring.downloadSnapshot(req.data.device_id, req.data.component_id ? [req.data.component_id] : undefined)
        : await ring.getStatus(req.data.device_id);
    if (req.data.mode === "snapshot") {
      // Same observation id the pipeline will derive, so the interpreter can find the media.
      const obsId = observationIdFor(eventIdempotencyKey("RING_PLAYGROUND", captureId));
      await rt.artifacts.putBytes(`media/${obsId}.jpg`, call.data as Uint8Array, "image/jpeg");
    }
    const capture = {
      capture_id: captureId,
      simulation_source: req.data.simulation_source,
      session_zone: req.data.session_zone,
      device_id: req.data.device_id,
      ...(req.data.component_id ? { component_id: req.data.component_id } : {}),
      ...(req.data.mode === "snapshot" ? { media_session_ref: `snapshot:${captureId}` } : {}),
      captured_at: capturedAt,
      api_evidence: {
        method: call.log.method,
        endpoint: call.log.path,
        http_status: call.log.status,
        ...(call.log.request_id ? { request_id: call.log.request_id } : {}),
        ...(req.data.mode === "probe" ? { response_excerpt: call.data } : {}),
      },
      ...(req.data.operator_note ? { operator_note: req.data.operator_note } : {}),
    };
    const r = await rt.pipeline.ingestPlaygroundCapture(capture);
    rt.log.info("playground_capture_ingested", { capture_id: captureId, endpoint: call.log.path, status: call.log.status });
    return json(r.status, { ...r, capture_id: captureId });
  } catch (err) {
    if (err instanceof RingApiError) {
      // Friction-log material: record exactly what the Ring API returned.
      rt.log.warn("ring_api_error", { path: err.path, status: err.status, body: err.body.slice(0, 500), retry_after: err.retryAfter });
      return json(502, { error: `Ring API ${err.status} on ${err.path}`, detail: err.body.slice(0, 500) });
    }
    throw err;
  }
}
