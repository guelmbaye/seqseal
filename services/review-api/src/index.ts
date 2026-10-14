/**
 * review-api — POST /api/reviews
 *
 * Human evidence review (Doc 03 §55–57): CONFIRM / REJECT / LEAVE_UNRESOLVED on an
 * unresolved evidence candidate. There is deliberately no "force release": confirmation
 * creates HUMAN_CONFIRMED evidence and the deterministic engine re-runs.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { awsRuntime, json, rawBody, requireDemoToken } from "@seqseal/aws";
import { ReviewAction } from "@seqseal/contracts";
import { z } from "zod";

const Body = z.object({
  candidate_id: z.string().min(1),
  action: ReviewAction,
  reviewer_ref: z.string().min(1).max(120),
  rationale: z.string().max(1000).optional(),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const denied = await requireDemoToken(event);
  if (denied) return denied;
  const parsed = Body.safeParse(JSON.parse(rawBody(event) || "{}"));
  if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  const rt = await awsRuntime("review-api");
  try {
    const { review } = await rt.pipeline.review(parsed.data);
    return json(202, { review, note: "Evidence updated; the Sequence Integrity Engine re-evaluates asynchronously." });
  } catch (err) {
    return json(409, { error: err instanceof Error ? err.message : String(err) });
  }
}
