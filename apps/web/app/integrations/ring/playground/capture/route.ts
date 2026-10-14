import { localPlaygroundCapture } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ring Developer Playground capture (see scripts/ring-spike.ts capture --post http://localhost:3000). */
export async function POST(req: Request) {
  const r = await localPlaygroundCapture(await req.json().catch(() => ({})));
  return Response.json(r.body, { status: r.status });
}
