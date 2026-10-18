/**
 * Ring Source Spike (G5) — ground the integration in what the Ring API actually returns.
 *
 *   RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts discover
 *       → GET /v1/users/me, /v1/devices?include=…, per-device status/capabilities/history
 *         saved (tokens redacted) to fixtures/ring/spike-<timestamp>/ and a call log printed
 *         for docs/ring-playground-observations.md and docs/FRICTION_LOG.md.
 *
 *   RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts history --device <id> [--query name=value]… [--pages <n>]
 *       → diagnostic: every event the device's history lists right now (following links.next),
 *         newest first, with start/end times and the session that captured it, if any.
 *
 *   RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts capture --device <id> --source PACKAGE --zone staging \
 *         [--session <name>] [--again] [--post <seqseal-url> --token <demo-token>] [--wait <s>] [--max-age <s>]
 *         [--require-event] [--no-history]
 *       → run right after clicking a simulation in the Playground. Reads the device's event
 *         history and binds the capture to the newest Ring event, if no session captured it before
 *         and it ended less than --max-age seconds ago (default 180) (its id
 *         and `start` become the source event and the physical time); falls back to a status
 *         probe if no history event appears within --wait seconds (default 60), or stops without
 *         sending anything with --require-event. One session is
 *         one delivery: the same simulation in the same zone twice is refused unless --again. With --post, checks
 *         that SEQSEAL is up first and saves the capture to fixtures/ring/captures/<session>.jsonl
 *         (for Ring-derived replay) only once SEQSEAL accepted it.
 *
 * The base URL defaults to https://api.amazonvision.com (Ring API reference); set
 * RING_API_BASE_URL if the Playground uses another host. Nothing here invents semantics.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compilePwpsFile } from "@pwps/core";
import { loadPipelineConfig } from "@seqseal/pipeline";
import { latestHistoryEvent, RingApiClient, RingApiError, summarizeDevices, summarizeHistory, type RingApiCallLog } from "@seqseal/ring-adapter";

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

/** Windows consoles often render ✓/✕ as "?"; use plain markers there. */
const OK = process.platform === "win32" ? "[ok]" : "✓";
const FAIL = process.platform === "win32" ? "[x]" : "✕";

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
      `\n  ${FAIL} Ring rejected the request for ${label} (HTTP ${err.status}${timeRange ? " TIME_RANGE_NOT_AUTHORIZED" : ""}). Nothing was saved.\n` +
        (timeRange
          ? "  The event happened before this token was issued. Generate a new token first, then run the simulation, then capture.\n"
          : `  The token was refused${expiry && expiry.getTime() < Date.now() ? ` (it expired at ${expiry.toISOString().slice(11, 16)} UTC)` : ""}; Playground tokens are short-lived.\n`) +
        `  ${SET_TOKEN_HELP.split("\n").join("\n  ")}`,
    );
    process.exit(1);
  }
}
const calls: RingApiCallLog[] = [];
// History calls were observed taking ~10 s (2026-10-18): allow 25 s before giving up on one call.
const ring = new RingApiClient({
  baseUrl: process.env.RING_API_BASE_URL ?? "https://api.amazonvision.com",
  accessToken: token,
  timeoutMs: 25_000,
  onRequest: (l) => calls.push(l),
});
const redact = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).split(token).join("<redacted>"));

async function attempt<T>(label: string, fn: () => Promise<{ data: T }>): Promise<T | undefined> {
  try {
    return (await fn()).data;
  } catch (err) {
    stopOnAuthError(err, label);
    if (err instanceof RingApiError) console.log(`  ${FAIL} ${label}: HTTP ${err.status} ${err.body.slice(0, 200)}`);
    else if (err instanceof Error && err.name === "AbortError") console.log(`  ! ${label}: Ring did not answer within 25 s; asking again.`);
    else console.log(`  ${FAIL} ${label}: ${String(err)}`);
    return undefined;
  }
}

/**
 * Reads a device's event history, following `links.next` up to `maxPages` pages. Returns every
 * item with the index (in `calls`) of the call that returned it, so a capture cites that call.
 */
async function readHistory(device: string, query: Record<string, string> = {}, maxPages = 5) {
  const items: Array<{ item: unknown; callIndex: number }> = [];
  const pages: Array<ReturnType<typeof summarizeHistory> & { callIndex: number; links?: unknown; meta?: unknown }> = [];
  let body = await attempt("event history", () => ring.getEventHistory(device, query));
  while (body !== undefined) {
    const callIndex = calls.length - 1;
    const obj = (body ?? {}) as Record<string, unknown>;
    const list = Array.isArray(body) ? body : [obj.data, obj.events, obj.items, obj.results].find(Array.isArray);
    for (const item of Array.isArray(list) ? list : []) items.push({ item, callIndex });
    const s = summarizeHistory(body);
    pages.push({ ...s, callIndex, links: obj.links, meta: obj.meta });
    if (!s.next || pages.length >= maxPages) break;
    const next = s.next;
    body = await attempt(`event history page ${pages.length + 1}`, () => ring.getHistoryLink(next));
  }
  return { ok: pages.length > 0, items, pages, newest: latestHistoryEvent({ data: items.map((i) => i.item) }) };
}

const hhmmss = (iso?: string) => (iso ? iso.slice(11, 19) : "--:--:--");

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

  // Captures that SEQSEAL accepted are appended to fixtures/ring/captures/<session>.jsonl so the
  // session can later be replayed as RING_DERIVED_REPLAY (demo fallback level 2).
  const session = arg("session") ?? `playground-${new Date().toISOString().slice(0, 10)}`;
  const capDir = join("fixtures", "ring", "captures");
  mkdirSync(capDir, { recursive: true });
  const sessionFile = join(capDir, `${session.replace(/[^A-Za-z0-9._-]/g, "-")}.jsonl`);
  type SavedCapture = { simulation_source?: string; session_zone?: string; captured_at?: string; ring_event?: { event_id: string } };
  const previous = existsSync(sessionFile)
    ? readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as SavedCapture)
    : [];
  // Ring events already captured in ANY session: the newest history event may still be the
  // previous delivery's last step until the new simulation's event shows up.
  const capturedIn = new Map<string, string>();
  for (const f of readdirSync(capDir).filter((n) => n.endsWith(".jsonl"))) {
    for (const l of readFileSync(join(capDir, f), "utf8").split("\n").filter(Boolean)) {
      try {
        const id = (JSON.parse(l) as SavedCapture).ring_event?.event_id;
        if (id) capturedIn.set(id, f.replace(/\.jsonl$/, ""));
      } catch {
        /* a damaged line is not an event id */
      }
    }
  }
  const stepOf = (c: SavedCapture) => `${c.simulation_source} -> ${c.session_zone}`;

  // A session is one delivery: the same simulation in the same zone twice would be a second
  // Arrival (or a second Staging…), which SEQSEAL rightly treats as ambiguous and sends to review.
  const same = previous.find((c) => c.simulation_source === source && c.session_zone === zone);
  if (same && !process.argv.includes("--again")) {
    console.error(
      `  ${FAIL} session "${session}" already has ${stepOf(same)}${same.captured_at ? ` (captured ${same.captured_at.slice(11, 19)} UTC)` : ""}. Ring was not called and nothing was saved.\n` +
        "    One session is one delivery: the same step twice would put two of that step in the delivery, and SEQSEAL would send it to review.\n" +
        "    For the next delivery, use a new session (for example --session demo-b). To repeat this step on purpose, add --again.",
    );
    process.exit(1);
  }

  // 0. If the capture goes to SEQSEAL, make sure SEQSEAL is up before touching Ring or saving anything.
  //    In dev mode (`pnpm demo`) the first request to a route compiles it, which can take several
  //    seconds: keep waiting while the server answers slowly, fail fast only if nothing listens.
  if (post) {
    const local = post.includes("localhost") || post.includes("127.0.0.1");
    const deadline = Date.now() + 60_000;
    let refused = false;
    let up = false;
    console.log(`  checking SEQSEAL at ${post}…`);
    for (let attemptNo = 0; Date.now() < deadline; attemptNo++) {
      try {
        const r = await fetch(`${post}/api/status`, { signal: AbortSignal.timeout(20_000) });
        up = r.ok;
        if (up) break;
        console.error(`  ${FAIL} SEQSEAL answered HTTP ${r.status} on /api/status.`);
        break;
      } catch (err) {
        const code = (err as { cause?: { code?: string; errors?: Array<{ code?: string }> } }).cause;
        refused = code?.code === "ECONNREFUSED" || !!code?.errors?.some((e) => e.code === "ECONNREFUSED");
        if (refused) break;
        if (attemptNo === 0) console.log("  SEQSEAL is starting or compiling its routes (first request in dev mode); waiting…");
      }
    }
    if (!up) {
      console.error(
        `  ${FAIL} SEQSEAL is not reachable at ${post}${refused ? " (nothing is listening on that port)" : " (no answer within 60 s)"}. Nothing was called and nothing was saved.\n` +
          (local
            ? "    Start it in another terminal from the repository folder with: pnpm demo\n    Wait for \"Ready\", open http://localhost:3000 once, then run this capture again."
            : "    Check the API URL (terraform output -raw api_endpoint) and your network."),
      );
      process.exit(1);
    }
  }

  // 0b. SEQSEAL knows lanes, not sessions: one delivery is open per lane at a time (BN-015).
  //     Refuse a step that would land in the wrong delivery, before touching Ring.
  const pipelineConfig = loadPipelineConfig();
  const { protocol } = pipelineConfig;
  const state = pipelineConfig.sources.mappings.find(
    (m) => m.when.event_type.includes("live_view_simulation") && m.when.logical_zone === zone && (!m.when.simulation_source || m.when.simulation_source.includes(source)),
  )?.state;
  const label = (s: string) => protocol.stateIndex[s]?.label ?? s;
  const force = process.argv.includes("--force");
  const refuse = (why: string) => {
    console.error(`  ${FAIL} ${why}\n    Ring was not called and nothing was saved.${force ? "" : " To capture anyway, add --force."}`);
    if (!force) process.exit(1);
  };
  if (!state) refuse(`${source} in zone ${zone} matches no workflow step, so it would check no box.`);
  if (post && state) {
    let open: Array<{ execution_id: string; observed: string[] }> | undefined;
    try {
      const r = await fetch(`${post}/api/executions?limit=50`, { signal: AbortSignal.timeout(20_000) });
      const list = r.ok ? ((await r.json()) as Array<{ execution_id: string; status: string; observed: string[] }>) : undefined;
      open = list?.filter((e) => e.status === "ACTIVE" && !e.observed.some((s) => protocol.terminalStates.includes(s)));
    } catch {
      open = undefined;
    }
    if (!open) console.log("  ! could not read the open deliveries from SEQSEAL; skipping the lane check.");
    else {
      const current = open[0];
      const steps = (e: { observed: string[] }) => e.observed.map(label).join(", ") || "none";
      const remaining = (e: { observed: string[] }) => protocol.expectedSequence.filter((s) => !e.observed.includes(s)).map(label).join(", ");
      if (state === protocol.openingState && current) {
        refuse(
          `delivery ${current.execution_id} is still open (steps so far: ${steps(current)}). A second ${label(state)} on the same lane would make both deliveries ambiguous, and SEQSEAL would send them to review.\n` +
            `    Finish it first (remaining: ${remaining(current)}), or press Clear results to start over.`,
        );
      } else if (state !== protocol.openingState && !current) {
        refuse(`no delivery is open on the lane. Capture its ${label(protocol.openingState)} first (VEHICLE in receiving-entry); this step would otherwise belong to no delivery.`);
      } else if (state !== protocol.openingState && current && previous.length === 0) {
        refuse(
          `session "${session}" has no ${label(protocol.openingState)} yet, so this step would be added to the delivery that is already open, ${current.execution_id} (steps so far: ${steps(current)}).\n` +
            `    Continue that delivery in its own session, or press Clear results and start with ${label(protocol.openingState)}.`,
        );
      } else if (current) {
        console.log(`  adding ${label(state)} to delivery ${current.execution_id} (steps so far: ${steps(current)})`);
      }
    }
  }

  // 1. Ground the capture in the Ring history event the simulation produced.
  // A Vehicle simulation lasts ~40 s and its event is listed at about its end: 90 s leaves room
  // for clicking the simulation just after starting this command.
  const waitSeconds = Math.max(0, Number(arg("wait") ?? 90));
  // A simulation's event shows up within about 30 s of its end (observed 2026-10-18). Anything much
  // older belongs to an earlier simulation and must not become this step's physical time.
  const maxAgeSeconds = Math.max(1, Number(arg("max-age") ?? 180));
  const requireEvent = process.argv.includes("--require-event");
  let ringEvent: ReturnType<typeof latestHistoryEvent>;
  let skipped = "";
  let lastHistory: Awaited<ReturnType<typeof readHistory>> | undefined;
  if (!process.argv.includes("--no-history")) {
    const waitStarted = Date.now();
    const deadline = waitStarted + waitSeconds * 1000;
    for (let i = 0; ; i++) {
      lastHistory = await readHistory(device);
      ringEvent = lastHistory.newest;
      if (ringEvent) {
        const endMs = Date.parse(ringEvent.ended_at ?? ringEvent.occurred_at ?? "");
        const age = Number.isNaN(endMs) ? undefined : Math.round((Date.now() - endMs) / 1000);
        const owner = capturedIn.get(ringEvent.event_id);
        if (owner) skipped = `the newest Ring event (${ringEvent.event_id.slice(-12)}) was already captured in session "${owner}"`;
        else if (age !== undefined && age > maxAgeSeconds) skipped = `the newest Ring event (${ringEvent.event_id.slice(-12)}) ended ${age} s ago, more than --max-age ${maxAgeSeconds} s`;
        else break;
      }
      ringEvent = undefined;
      if (Date.now() >= deadline) break;
      if (i === 0) console.log(`  waiting up to ${waitSeconds} s for the event of the ${source} simulation. If you have not clicked it in the Playground yet, click it now.`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    if (ringEvent) {
      const waited = Math.round((Date.now() - waitStarted) / 1000);
      const lasted = ringEvent.occurred_at && ringEvent.ended_at ? (Date.parse(ringEvent.ended_at) - Date.parse(ringEvent.occurred_at)) / 1000 : undefined;
      console.log(`  ${OK} Ring history event ${ringEvent.event_id}${ringEvent.event_type ? ` (${ringEvent.event_type})` : ""}`);
      if (ringEvent.occurred_at) {
        console.log(
          `    started ${ringEvent.occurred_at.slice(11, 23)} UTC${lasted !== undefined ? `, lasted ${lasted.toFixed(1)} s` : ""}` +
            `${waited > 0 ? `; appeared after ${waited} s of waiting` : ""}. SEQSEAL uses the start as the physical time.`,
        );
      } else {
        console.log("    Ring gave no time for this event; SEQSEAL will use the capture time instead.");
      }
    } else {
      console.log(
        `  ! no new Ring history event within ${waitSeconds} s${skipped ? `: ${skipped}` : ""}.\n` +
          `    Ring listed ${lastHistory?.items.length ?? 0} event(s) on ${lastHistory?.pages.length ?? 0} page(s)` +
          `${lastHistory?.newest ? `; newest ${lastHistory.newest.event_id.slice(-12)} started ${hhmmss(lastHistory.newest.occurred_at)} UTC` : ""}.` +
          ` Details: pnpm tsx scripts/ring-spike.ts history --device <id>\n` +
          "    Ring lists a simulation's event at about the end of its video (Package and Motion ~22 s, Vehicle ~40 s).\n" +
          "    Click the simulation in the Playground first, then run this command; it waits for the event.\n" +
          (requireEvent
            ? "    --require-event is set: nothing was sent and nothing was saved. Click the simulation again, then rerun this command."
            : "    Falling back to a status probe: it proves the Ring API answered for this device, not that this simulation happened.\n" +
              "    The evidence drawer will say \"Ring API call only\". Add --require-event to refuse such captures."),
      );
      if (requireEvent) process.exit(1);
    }
  }
  // 2. Without a history event, prove at least that the Ring API answered for this device.
  if (!ringEvent) await attempt("status probe", () => ring.getStatus(device));
  // Cite the Ring call that actually returned the event (history may span several pages).
  const eventCall = ringEvent ? lastHistory?.items.find((i) => i.item === ringEvent!.raw)?.callIndex : undefined;
  const call = (eventCall !== undefined ? calls[eventCall] : undefined) ?? calls.at(-1)!;
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
      ? {
          ring_event: {
            event_id: ringEvent.event_id,
            ...(ringEvent.event_type ? { event_type: ringEvent.event_type } : {}),
            ...(ringEvent.occurred_at ? { occurred_at: ringEvent.occurred_at } : {}),
            ...(ringEvent.ended_at ? { ended_at: ringEvent.ended_at } : {}),
          },
        }
      : {}),
    operator_note: arg("note") ?? `Playground ${source} simulation declared as zone ${zone}`,
  };
  if (call.status < 200 || call.status >= 300) {
    console.error(`  ${FAIL} the Ring API call failed (HTTP ${call.status}); nothing saved — SEQSEAL refuses captures without a successful Ring call.`);
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
        signal: AbortSignal.timeout(45_000), // dev mode compiles the capture route on its first call
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      console.error(`  ${FAIL} could not reach SEQSEAL at ${post} (${err instanceof Error ? err.message : String(err)}). The capture was not saved; run the command again once SEQSEAL is up.`);
      process.exit(1);
    }
    if (status < 200 || status >= 300) {
      console.error(`  ${FAIL} SEQSEAL answered HTTP ${status}: ${body.slice(0, 300)}\n    The capture was not saved.`);
      process.exit(1);
    }
    console.log(`  ${OK} SEQSEAL accepted the capture (HTTP ${status}). Watch the checklist at ${post.includes("execute-api") ? "the web console" : post}.`);
  }
  appendFileSync(sessionFile, `${JSON.stringify(capture)}\n`);
  console.log(`  saved to ${sessionFile} (${previous.length + 1} capture${previous.length ? "s" : ""} in this session; replay later with: pnpm replay --captures ${sessionFile})`);
  console.log(`  steps in session "${session}": ${[...previous, capture].map(stepOf).join(", ")}`);
} else if (cmd === "history") {
  // Diagnostic: what the device's event history contains right now, page by page.
  const device = arg("device");
  if (!device) {
    console.error("history requires --device <id> [--query name=value]… [--pages <n>]");
    process.exit(2);
  }
  const query: Record<string, string> = {};
  process.argv.forEach((a, i) => {
    if (a !== "--query") return;
    const [k, ...v] = (process.argv[i + 1] ?? "").split("=");
    if (k) query[k] = v.join("=");
  });
  const h = await readHistory(device, query, Math.max(1, Number(arg("pages") ?? 5)));
  if (!h.ok) process.exit(1);
  const capDir = join("fixtures", "ring", "captures");
  const capturedIn = new Map<string, string>();
  if (existsSync(capDir)) {
    for (const f of readdirSync(capDir).filter((n) => n.endsWith(".jsonl"))) {
      for (const l of readFileSync(join(capDir, f), "utf8").split("\n").filter(Boolean)) {
        try {
          const id = (JSON.parse(l) as { ring_event?: { event_id?: string } }).ring_event?.event_id;
          if (id) capturedIn.set(id, f.replace(/\.jsonl$/, ""));
        } catch {
          /* skip a damaged line */
        }
      }
    }
  }
  console.log(`  now ${new Date().toISOString().slice(11, 19)} UTC${Object.keys(query).length ? `, query ${new URLSearchParams(query).toString()}` : ""}`);
  h.pages.forEach((pg, i) => {
    const c = calls[pg.callIndex];
    console.log(
      `  page ${i + 1}: ${pg.count} event(s), order ${pg.order}, next page: ${pg.next ? "yes" : "no"}` +
        ` (HTTP ${c?.status}, request id ${c?.request_id ?? "—"}, ${c?.duration_ms} ms)`,
    );
    if (i === 0 && (pg.links || pg.meta)) console.log(`    links ${JSON.stringify(redact(pg.links ?? null))}  meta ${JSON.stringify(redact(pg.meta ?? null))}`);
  });
  const events = h.items
    .map((i) => latestHistoryEvent({ data: [i.item] }))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""));
  console.log(`  ${events.length} event(s) in total, newest first:`);
  for (const e of events.slice(0, 10)) {
    const lasted = e.occurred_at && e.ended_at ? `${((Date.parse(e.ended_at) - Date.parse(e.occurred_at)) / 1000).toFixed(1)} s` : "";
    const ago = e.ended_at ?? e.occurred_at ? `${Math.round((Date.now() - Date.parse((e.ended_at ?? e.occurred_at)!)) / 60_000)} min ago` : "";
    const owner = capturedIn.get(e.event_id);
    console.log(`    …${e.event_id.slice(-12)}  ${e.event_type ?? "?"}  ${hhmmss(e.occurred_at)}–${hhmmss(e.ended_at)} UTC  ${lasted}  ${ago}${owner ? `  (captured in ${owner})` : ""}`);
  }
} else {
  console.error("usage: ring-spike.ts discover | history --device <id> [--query name=value] | capture --device <id> --source <PACKAGE|VEHICLE|MOTION> --zone <zone> [--post <url> --token <t>] [--session <name>] [--again] [--wait <seconds>] [--max-age <seconds>] [--require-event] [--no-history]");
  process.exit(2);
}
