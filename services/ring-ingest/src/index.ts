/**
 * ring-ingest — POST /integrations/ring/webhook
 *
 * Responsibilities (Doc 04 §19, Doc 06 §26): read the RAW body, verify X-Signature
 * (HMAC-SHA256), establish delivery idempotency, persist the raw source record,
 * publish RingSourceEventReceived, respond fast (Ring expects < 5 s; we target < 1 s).
 * Never: Bedrock, evidence mapping, protocol evaluation, business actions.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { awsRuntime, json, rawBody } from "@seqseal/aws";
import type { SourceProfile } from "@seqseal/contracts";

const PROFILE = (process.env.RING_SOURCE_PROFILE ?? "RING_WEBHOOK") as SourceProfile;

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const started = Date.now();
  const rt = await awsRuntime("ring-ingest", { ringSigningSecret: true });
  const result = await rt.pipeline.ingestWebhook({
    rawBody: rawBody(event),
    headers: event.headers as Record<string, string | undefined>,
    profile: PROFILE,
  });
  rt.log.info("ring_webhook_ingested", {
    outcome: result.outcome,
    status: result.status,
    source_record_id: result.source_record_id,
    correlation_id: result.correlation_id,
    duration_ms: Date.now() - started,
  });
  // 4xx are permanent for Ring (no retry); duplicates acknowledge with 200.
  return json(result.status, { outcome: result.outcome, ...(result.correlation_id ? { correlation_id: result.correlation_id } : {}), ...(result.error ? { error: result.error } : {}) });
}
