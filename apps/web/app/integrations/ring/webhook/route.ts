import { localWebhook } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local Ring webhook endpoint: the raw body is passed through untouched for HMAC verification. */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const r = await localWebhook(rawBody, headers);
  return Response.json(r.body, { status: r.status });
}
