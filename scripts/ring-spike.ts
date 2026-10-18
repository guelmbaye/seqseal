/**
 * Ring Source Spike (G5) — ground the integration in what the Ring API actually returns.
 *
 *   RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts discover
 *       → GET /v1/users/me, /v1/devices?include=…, per-device status/capabilities/history
 *         saved (tokens redacted) to fixtures/ring/spike-<timestamp>/ and a call log printed
 *         for docs/ring-playground-observations.md and docs/FRICTION_LOG.md.
 *
 *   RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts capture --device <id> --source PACKAGE --zone staging \
 *         [--session <name>] [--post <seqseal-url> --token <demo-token>] [--wait <s>] [--no-history]
 *       → run right after clicking a simulation in the Playground. Reads the device's event
 *         history and binds the capture to the newest Ring event not captured before (its id
 *         and timestamp become the source event and the physical time); falls back to a status
 *         probe if no history event appears within --wait seconds (default 60). With --post, checks
 *         that SEQSEAL is up first and saves the capture to fixtures/ring/captures/<session>.jsonl
 *         (for Ring-derived replay) only once SEQSEAL accepted it.
 *
 * The base URL defaults to https://api.amazonvision.com (Ring API reference); set
 * RING_API_BASE_URL if the Playground uses another host. Nothing here invents semantics.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compilePwpsFile } from "@pwps/core";
import { latestHistoryEvent, RingApiClient, RingApiError, summarizeDevices, type RingApiCallLog } from "@seqseal/ring-adapter";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const token = (process.env.RING_PLAYGROUND_TOKEN ?? "").trim();
const SET_TOKEN_HELP =
  "Click Generate Token in the Ring Developer Playground, then set it in this terminal:\n" +
  '    PowerShell:  $env:RING_PLAYGROUND_TOKEN = "<token>"\n' +
  '    bash/zsh:    export RING_PLAYGROUND_TOKEN="<token>"';
if (!token) {
  console.error(`RING_PLAYGROUND_TOKEN is not set (it is never written to disk).\n${SET_TOKEN_HELP}`);
  process.exit(2);
}

/** Read the expiry of a JWT access token locally (no verification, nothing printed but the time). */
function tokenExpiry(t: string): Date | undefined {
  try {
    const payload = JSON.parse(Buffer.from(t.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}
const expiry = tokenExpiry(token);
if (expiry) {
  const minutesLeft = Math.floor((expiry.getTime() - Date.now()) / 60_000);
  if (minutesLeft < 0) {
    console.error(`The Playground token expired at ${expiry.toISOString().slice(11, 16)} UTC (${-minutesLeft} min ago).\n${SET_TOKEN_HELP}`);
    process.exit(2);
  }
  console.log(`Token valid until ${expiry.toISOString().slice(11, 16)} UTC (${minutesLeft} min left).`);
}

/** 401/403 never fix themselves by waiting: stop at once and say why. */
function stopOnAuthError(err: unknown, label: string): void {
  if (err instanceof RingApiError && (err.status === 401 || err.status === 403)) {
    const timeRange = err.body.includes("TIME_RANGE_NOT_AUTHORIZED");
    console.error(
      `\n  ✕ Ring rejected the request for ${label} (HTTP ${err.status}${timeRange ? " TIME_RANGE_NOT_AUTHORIZED" : ""}). Nothing was saved.\n` +
        (timeRange
          ? "  The event happened before this token was issued. Generate a new token first, then run the simulation, then capture.\n"
          : `  The token was refused${expiry && expiry.getTime() < Date.now() ? ` (it expired at ${expiry.toISOString().slice(11, 16)} UTC)` : ""}; Playground tokens are short-lived.\n`) +
        `  ${SET_TOKEN_HELP.split("\n").join("\n  ")}`,
    );
    process.exit(1);
  }
}
const calls: RingApiCallLog[] = [];
const ring = new RingApiClient({ baseUrl: process.env.RING_API_BASE_URL ?? "https://api.amazonvision.com", accessToken: token, onRequest: (l) => calls.push(l) });
const redact = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).split(token).join("<redacted>"));

async function attempt<T>(label: string, fn: () => Promise<{ data: T }>): Promise<T | undefined> {
  try {
    return (await fn()).data;
  } catch (err) {
    stopOnAuthError(err, label);
    if (err instanceof RingApiError) console.log(`  ✕ ${label}: HTTP ${err.status} ${err.body.slice(0, 200)}`);
    else console.log(`  ✕ ${label}: ${String(err)}`);
    return undefined;
  }
}

/** Field names and value types only: enough to document the API without keeping personal data. */
function shapeOf(v: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1)] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shapeOf(x, depth + 1)]));
  return v === null ? "null" : typeof v;
}

const cmd = process.argv[2];
if (cmd === "discover") {
  const dir = join("fixtures", "ring", `spike-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  const me = await attempt("users/me", () => ring.getMe());
  // The account record is personal data: keep only its shape.
  writeFileSync(join(dir, "users-me.shape.json"), JSON.stringify(shapeOf(me), null, 2));
  const devices = await attempt("devices", () => ring.listDevices());
  writeFileSync(join(dir, "devices.json"), JSON.stringify(redact(devices), null, 2));
  for (const d of summarizeDevices(devices)) {
    console.log(`device ${d.id}`);
    for (const [name, fn] of [
      ["status", () => ring.getStatus(d.id)],
      ["capabilities", () => ring.getCapabilities(d.id)],
      ["configurations", () => ring.getConfigurations(d.id)],
      ["history", () => ring.getEventHistory(d.id)],
    ] as const) {
      const data = await attempt(`${d.id}/${name}`, fn as () => Promise<{ data: unknown }>);
      writeFileSync(join(dir, `${d.id}-${name}.json`), JSON.stringify(redact(data), null, 2));
    }
  }
  writeFileSync(join(dir, "call-log.json"), JSON.stringify(calls, null, 2));
  console.log(`\n${calls.length} calls → ${dir}`);
  for (const c of calls) console.log(`  ${c.method.padEnd(6)} ${c.path.padEnd(60)} ${c.status}  ${c.duration_ms} ms`);
} else if (cmd === "capture") {
  const device = arg("device");
  const source = arg("source")?.toUpperCase();
  const zone = arg("zone");
  const zones = compilePwpsFile(join("protocols", "inbound-delivery.yaml")).zones.map((z) => z.id);
  if (!device || !source || !zone) {
    console.error(`capture requires --device <id> --source PACKAGE|VEHICLE|MOTION --zone <${zones.join("|")}>`);
    process.exit(2);
  }
  if (!["PACKAGE", "VEHICLE", "MOTION"].includes(source)) {
    console.error(`--source must be PACKAGE, VEHICLE or MOTION (got ${source}).`);
    process.exit(2);
  }
  if (!zones.includes(zone)) {
    console.error(`--zone must be one of ${zones.join(", ")} (got ${zone}).`);
    process.exit(2);
  }
  const post = arg("post")?.replace(/\/$/, "");
  const demoToken = arg("token") ?? process.env.SEQSEAL_DEMO_TOKEN ?? "";

  // 0. If the capture goes to SEQSEAL, make sure SEQSEAL is up before touching Ring or saving anything.
  if (post) {
    const up = await fetch(`${post}/api/status`, { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);
    if (!up) {
      console.error(
        `  ✕ SEQSEAL is not reachable at ${post}. Nothing was called and nothing was saved.\n` +
          (post.includes("localhost") || post.includes("127.0.0.1")
            ? "    Start it in another terminal (from the repository folder): pnpm demo\n    Wait for \"Ready\", open http://localhost:3000 once, then run this capture again."
            : "    Check the API URL (terraform output -raw api_endpoint) and your network."),
      );
      process.exit(1);
    }
  }

  // Captures that SEQSEAL accepted are appended to fixtures/ring/captures/<session>.jsonl so the
  // session can later be replayed as RING_DERIVED_REPLAY (demo fallback level 2).
  const session = arg("session") ?? `playground-${new Date().toISOString().slice(0, 10)}`;
  const capDir = join("fixtures", "ring", "captures");
  mkdirSync(capDir, { recursive: true });
  const sessionFile = join(capDir, `${session.replace(/[^A-Za-z0-9._-]/g, "-")}.jsonl`);
  const previous = existsSync(sessionFile)
    ? readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { ring_event?: { event_id: string } })
    : [];
  const used = new Set(previous.flatMap((c) => (c.ring_event ? [c.ring_event.event_id] : [])));

  // 1. Ground the capture in the Ring history event the simulation produced.
  const waitSeconds = Math.max(0, Number(arg("wait") ?? 60));
  let ringEvent: ReturnType<typeof latestHistoryEvent>;
  let lastHistory: unknown;
  if (!process.argv.includes("--no-history")) {
    const deadline = Date.now() + waitSeconds * 1000;
    for (let i = 0; ; i++) {
      lastHistory = await attempt("event history", () => ring.getEventHistory(device));
      ringEvent = latestHistoryEvent(lastHistory);
      if (ringEvent && !used.has(ringEvent.event_id)) break;
      ringEvent = undefined;
      if (Date.now() >= deadline) break;
      if (i === 0) console.log(`  waiting up to ${waitSeconds} s for a new Ring history event…`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (ringEvent) {
      console.log(`  ✓ Ring history event ${ringEvent.event_id}${ringEvent.event_type ? ` (${ringEvent.event_type})` : ""}${ringEvent.occurred_at ? ` at ${ringEvent.occurred_at}` : ""}`);
    } else {
      console.log(
        `  ! no new Ring history event within ${waitSeconds} s. Ring returned: ${JSON.stringify(redact(lastHistory) ?? null).slice(0, 300)}\n` +
          "    Check: was the simulation clicked AFTER this token was generated, and did it finish (20–40 s)?\n" +
          "    Falling back to a status probe: it proves the Ring API answered for this device, not that this simulation happened.",
      );
    }
  }
  // 2. Without a history event, prove at least that the Ring API answered for this device.
  if (!ringEvent) await attempt("status probe", () => ring.getStatus(device));
  const call = calls.at(-1)!;
  const capture = {
    capture_id: `pg-${ringEvent?.event_id ?? randomUUID()}`,
    simulation_source: source,
    session_zone: zone,
    device_id: device,
    captured_at: new Date().toISOString(),
    api_evidence: {
      method: call.method,
      endpoint: call.path,
      http_status: call.status,
      ...(call.request_id ? { request_id: call.request_id } : {}),
      ...(ringEvent ? { response_excerpt: redact(ringEvent.raw) } : {}),
    },
    ...(ringEvent
      ? { ring_event: { event_id: ringEvent.event_id, ...(ringEvent.event_type ? { event_type: ringEvent.event_type } : {}), ...(ringEvent.occurred_at ? { occurred_at: ringEvent.occurred_at } : {}) } }
      : {}),
    operator_note: arg("note") ?? `Playground ${source} simulation declared as zone ${zone}`,
  };
  if (call.status < 200 || call.status >= 300) {
    console.error(`  ✕ the Ring API call failed (HTTP ${call.status}); nothing saved — SEQSEAL refuses captures without a successful Ring call.`);
    process.exit(1);
  }
  console.log(JSON.stringify(capture, null, 2));

  // 3. Send to SEQSEAL; keep the capture in the session file only once SEQSEAL accepted it.
  if (post) {
    let status = 0;
    let body = "";
    try {
      const res = await fetch(`${post}/integrations/ring/playground/capture`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-seqseal-demo-token": demoToken },
        body: JSON.stringify(capture),
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      console.error(`  ✕ could not reach SEQSEAL at ${post} (${err instanceof Error ? err.message : String(err)}). The capture was not saved; run the command again once SEQSEAL is up.`);
      process.exit(1);
    }
    if (status < 200 || status >= 300) {
      console.error(`  ✕ SEQSEAL answered HTTP ${status}: ${body.slice(0, 300)}\n    The capture was not saved.`);
      process.exit(1);
    }
    console.log(`  ✓ SEQSEAL accepted the capture (HTTP ${status}). Watch the checklist at ${post.includes("execute-api") ? "the web console" : post}.`);
  }
  appendFileSync(sessionFile, `${JSON.stringify(capture)}\n`);
  console.log(`  saved to ${sessionFile} (${previous.length + 1} capture${previous.length ? "s" : ""} in this session; replay later with: pnpm replay --captures ${sessionFile})`);
} else {
  console.error("usage: ring-spike.ts discover | capture --device <id> --source <PACKAGE|VEHICLE|MOTION> --zone <zone> [--post <url> --token <t>] [--session <name>] [--wait <seconds>] [--no-history]");
  process.exit(2);
}
