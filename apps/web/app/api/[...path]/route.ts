import { demoAction, readApi, reviewAction } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

const respond = (r: { status: number; body: unknown }) =>
  Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const query = Object.fromEntries(new URL(req.url).searchParams.entries());
  return respond(await readApi(`/api/${path.join("/")}`, query));
}

export async function POST(req: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (path[0] === "demo" && path[1]) return respond(await demoAction(path[1], body));
  if (path[0] === "reviews") return respond(await reviewAction(body));
  return respond({ status: 404, body: { error: "not found" } });
}
