import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { DomainEvent, EventName } from "@seqseal/contracts";
import { DisabledEvidenceInterpreter, MockEvidenceInterpreter, type EvidenceInterpreter } from "@seqseal/evidence-model";
import { jsonLogger, loadPipelineConfig, ReadModel, SeqSealPipeline, type Logger, type PipelineConfig } from "@seqseal/pipeline";
import { RingApiClient } from "@seqseal/ring-adapter";
import { BedrockEvidenceInterpreter } from "./bedrock";
import { DynamoDocDatabase, tableNamesFromEnv } from "./dynamo";
import { domainEventFromSqsBody, EventBridgeSink } from "./eventbridge";
import { emitMetrics } from "./metrics";
import { S3ArtifactStore } from "./s3";
import { getSecret, safeEqual } from "./secrets";

export const DEMO_TOKEN_HEADER = "x-seqseal-demo-token";

/** Throttling / transient infrastructure errors propagate for SQS retry; everything else becomes SYSTEM_ERROR. */
export function isRetryableAwsError(err: unknown): boolean {
  const e = err as { name?: string; $retryable?: unknown; $metadata?: { httpStatusCode?: number } };
  const retryableNames = [
    "ThrottlingException",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "ServiceUnavailable",
    "ServiceUnavailableException",
    "InternalServerError",
    "InternalServerException",
    "TransactionConflictException",
    "EventBridgePublishError",
    "TimeoutError",
  ];
  return !!e && (retryableNames.includes(e.name ?? "") || !!e.$retryable || (e.$metadata?.httpStatusCode ?? 0) >= 500);
}

let config: PipelineConfig | undefined;
let artifacts: S3ArtifactStore | undefined;

export interface AwsRuntime {
  pipeline: SeqSealPipeline;
  readModel: ReadModel;
  artifacts: S3ArtifactStore;
  config: PipelineConfig;
  log: Logger;
  interpreter: EvidenceInterpreter;
}

/**
 * Bedrock is used only when explicitly enabled, a model is configured and the kill switch
 * BEDROCK_DISABLED is not set (Master Brief §33: the hero A/B path must work with
 * BEDROCK_DISABLED=true). Even when enabled it can only propose evidence.
 */
export function bedrockEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BEDROCK_DISABLED !== "true" && env.ENABLE_BEDROCK_EVIDENCE === "true" && !!env.BEDROCK_EVIDENCE_MODEL_ID;
}

function interpreterFor(store: S3ArtifactStore): EvidenceInterpreter {
  const modelId = process.env.BEDROCK_EVIDENCE_MODEL_ID ?? "";
  if (bedrockEnabled()) {
    return new BedrockEvidenceInterpreter(modelId, async (req) => {
      // Metadata first; media only when needed (Doc 04 §55). Snapshot captured by the
      // Playground adapter, else a fresh Ring snapshot for webhook observations.
      for (const fmt of ["jpeg", "png"] as const) {
        const bytes = await store.getBytes(`media/${req.observation.observation_id}.${fmt === "jpeg" ? "jpg" : "png"}`);
        if (bytes) return { bytes, format: fmt };
      }
      const device = req.observation.source_device_ref;
      const token = await getSecret(process.env.RING_API_TOKEN_SECRET_ARN);
      // Never fetch fresh media for a replay: it would not show the replayed moment.
      if (!device || !token || req.observation.source_profile === "FIXTURE_REPLAY" || req.observation.source_profile === "RING_DERIVED_REPLAY") return undefined;
      const ring = new RingApiClient({ baseUrl: process.env.RING_API_BASE_URL ?? "https://api.amazonvision.com", accessToken: token });
      const snap = await ring.downloadSnapshot(device, req.observation.source_component_refs);
      await store.putBytes(`media/${req.observation.observation_id}.jpg`, snap.data, "image/jpeg");
      return { bytes: snap.data, format: "jpeg" };
    });
  }
  // Demo mode without Bedrock: deterministic, clearly labelled mock driven by fixture hints.
  return process.env.DEMO_MODE === "true" ? new MockEvidenceInterpreter() : new DisabledEvidenceInterpreter();
}

export interface AwsRuntimeOptions {
  /**
   * Load the Ring webhook signing secret. Only `ring-ingest` verifies webhook signatures, so
   * only its IAM role may read that secret; every other function must leave this off.
   */
  ringSigningSecret?: boolean;
}

export async function awsRuntime(service: string, opts: AwsRuntimeOptions = {}): Promise<AwsRuntime> {
  config ??= loadPipelineConfig();
  artifacts ??= new S3ArtifactStore(process.env.SEQSEAL_ARTIFACT_BUCKET ?? "");
  const log = jsonLogger(service);
  const interpreter = interpreterFor(artifacts);
  const pipeline = new SeqSealPipeline({
    db: new DynamoDocDatabase(tableNamesFromEnv()),
    config,
    interpreter,
    sink: new EventBridgeSink(process.env.SEQSEAL_EVENT_BUS ?? "seqseal-events"),
    artifacts,
    logger: log,
    isRetryable: isRetryableAwsError,
    options: {
      finalizationGraceMs: Number(process.env.FINALIZATION_GRACE_SECONDS ?? "0") * 1000,
      ...(opts.ringSigningSecret ? { ringSigningSecret: await getSecret(process.env.RING_SIGNING_SECRET_ARN) } : {}),
    },
  });
  const readModel = new ReadModel(pipeline.store, config, {
    backend: `aws:${process.env.SEQSEAL_ENVIRONMENT ?? "dev"}`,
    interpreter: interpreter.id,
    flags: {
      ENABLE_BEDROCK_EVIDENCE: bedrockEnabled(),
      BEDROCK_DISABLED: process.env.BEDROCK_DISABLED === "true",
      DEMO_MODE: process.env.DEMO_MODE === "true",
    },
  });
  return { pipeline, readModel, artifacts, config, log, interpreter };
}

/* ───────────── HTTP helpers ───────────── */

export function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

export function rawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

export function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/** Shared demo/operator token for mutating demo & review endpoints. */
export async function requireDemoToken(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2 | null> {
  const expected = await getSecret(process.env.DEMO_TOKEN_SECRET_ARN);
  const given = header(event, DEMO_TOKEN_HEADER) ?? "";
  if (!expected || !safeEqual(given, expected)) return json(401, { error: "unauthorized" });
  return null;
}

/* ───────────── SQS consumer ───────────── */

/**
 * Generic SQS consumer for one pipeline stage. Each stage only accepts the event names
 * routed to it (defence in depth beyond the EventBridge rules). Retryable infrastructure
 * errors are reported as batch item failures; domain failures become SYSTEM_ERROR events.
 */
export function sqsStage(service: string, accepts: EventName[]) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const rt = await awsRuntime(service);
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      let domainEvent: DomainEvent;
      try {
        domainEvent = domainEventFromSqsBody(record.body);
      } catch (err) {
        rt.log.error("malformed_message_dropped", { message_id: record.messageId, error: String(err) });
        continue; // permanent: never retry malformed messages forever (Doc 06 §110)
      }
      if (!accepts.includes(domainEvent.name as EventName)) {
        rt.log.warn("event_not_for_this_stage", { name: domainEvent.name, service });
        continue;
      }
      try {
        const produced = await rt.pipeline.handle(domainEvent);
        emitMetrics(produced);
        rt.log.info("stage_completed", {
          consumed: domainEvent.name,
          produced: produced.map((e) => e.name),
          correlation_id: domainEvent.correlation_id,
          execution_id: domainEvent.execution_id,
        });
      } catch (err) {
        rt.log.error("stage_retryable_failure", { consumed: domainEvent.name, error: String(err), correlation_id: domainEvent.correlation_id });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
