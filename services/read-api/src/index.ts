/** read-api — GET /api/* : read model for the judge-facing console. Read-only IAM. */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { awsRuntime, json } from "@seqseal/aws";
import { handleReadApi } from "@seqseal/pipeline";

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const rt = await awsRuntime("read-api");
  const r = await handleReadApi(rt.readModel, rt.pipeline.store, rt.config, event.requestContext.http.method, event.rawPath, (event.queryStringParameters ?? {}) as Record<string, string>);
  return json(r.status, r.body);
}
