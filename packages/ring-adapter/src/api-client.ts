/**
 * Minimal Ring Partner API client (only what the MVP needs).
 *
 * Base URL and paths follow the public Ring developer documentation
 * (https://developer.amazon.com/docs/ring/api-reference.html and api-documentation.html):
 *   GET  /v1/devices?include=status,capabilities,location,configurations
 *   GET  /v1/devices/{id} · /status · /capabilities · /configurations   (?component_id=N on multi-camera)
 *   GET  /v1/history/devices/{id}/events
 *   POST /v1/devices/{id}/media/image/download   { components }
 *   POST /v1/devices/{id}/media/video/download   { components, … }
 *   POST /v1/devices/{id}/media/streaming/whep/sessions   (application/sdp)
 *   GET  /v1/users/me
 * Paths are configurable because the Developer Playground host may differ; confirm them
 * during the Ring Source Spike (docs/ring-playground-observations.md) and log any friction.
 */
export interface RingApiConfig {
  baseUrl: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Called for every request — feeds provenance and the friction log. */
  onRequest?: (log: RingApiCallLog) => void;
}

export interface RingApiCallLog {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  request_id?: string;
  rate_limit_remaining?: string;
  at: string;
}

export class RingApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
    readonly retryAfter?: string,
  ) {
    super(`Ring API ${status} on ${path}`);
    this.name = "RingApiError";
  }
}

export interface RingApiResponse<T> {
  status: number;
  data: T;
  log: RingApiCallLog;
}

export class RingApiClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly cfg: RingApiConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, path: string, init: { body?: string; contentType?: string; accept?: string; binary?: boolean } = {}): Promise<RingApiResponse<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 10_000);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          Accept: init.accept ?? "application/vnd.api+json, application/json",
          ...(init.contentType ? { "Content-Type": init.contentType } : {}),
        },
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: controller.signal,
      });
      const log: RingApiCallLog = {
        method,
        path,
        status: res.status,
        duration_ms: Date.now() - started,
        ...(res.headers.get("x-request-id") ? { request_id: res.headers.get("x-request-id")! } : {}),
        ...(res.headers.get("x-ratelimit-remaining") ? { rate_limit_remaining: res.headers.get("x-ratelimit-remaining")! } : {}),
        at: new Date().toISOString(),
      };
      this.cfg.onRequest?.(log);
      if (!res.ok) throw new RingApiError(res.status, path, await res.text().catch(() => ""), res.headers.get("retry-after") ?? undefined);
      const data = init.binary
        ? (new Uint8Array(await res.arrayBuffer()) as unknown as T)
        : res.status === 204
          ? (undefined as T)
          : ((await res.text().then((t) => (t ? JSON.parse(t) : undefined))) as T);
      return { status: res.status, data, log };
    } finally {
      clearTimeout(timer);
    }
  }

  getMe() {
    return this.call<unknown>("GET", "/v1/users/me");
  }
  listDevices(include: string[] = ["status", "capabilities", "configurations"]) {
    return this.call<unknown>("GET", `/v1/devices${include.length ? `?include=${include.join(",")}` : ""}`);
  }
  getDevice(id: string) {
    return this.call<unknown>("GET", `/v1/devices/${encodeURIComponent(id)}`);
  }
  getStatus(id: string) {
    return this.call<unknown>("GET", `/v1/devices/${encodeURIComponent(id)}/status`);
  }
  getCapabilities(id: string, componentId?: string) {
    return this.call<unknown>("GET", `/v1/devices/${encodeURIComponent(id)}/capabilities${componentId ? `?component_id=${componentId}` : ""}`);
  }
  getConfigurations(id: string, componentId?: string) {
    return this.call<unknown>("GET", `/v1/devices/${encodeURIComponent(id)}/configurations${componentId ? `?component_id=${componentId}` : ""}`);
  }
  getEventHistory(id: string, query: Record<string, string> = {}) {
    const qs = new URLSearchParams(query).toString();
    return this.call<unknown>("GET", `/v1/history/devices/${encodeURIComponent(id)}/events${qs ? `?${qs}` : ""}`);
  }
  /** Follows a `links.next` value from a history page. Only links on the configured API host are followed. */
  getHistoryLink(link: string) {
    const base = this.cfg.baseUrl.replace(/\/$/, "");
    if (/^https?:\/\//.test(link) && !link.startsWith(`${base}/`)) throw new Error(`refusing to follow a link outside ${base}: ${link}`);
    const path = link.startsWith(base) ? link.slice(base.length) : link.startsWith("/") ? link : `/${link}`;
    return this.call<unknown>("GET", path);
  }
  downloadSnapshot(id: string, components?: string[]) {
    return this.call<Uint8Array>("POST", `/v1/devices/${encodeURIComponent(id)}/media/image/download`, {
      body: JSON.stringify(components?.length ? { components } : {}),
      contentType: "application/json",
      accept: "image/jpeg, image/png",
      binary: true,
    });
  }
  startWhepSession(id: string, sdpOffer: string, componentId?: string) {
    return this.call<string>("POST", `/v1/devices/${encodeURIComponent(id)}/media/streaming/whep/sessions${componentId ? `?component_id=${componentId}` : ""}`, {
      body: sdpOffer,
      contentType: "application/sdp",
      accept: "application/sdp",
    });
  }
  closeWhepSession(id: string, sessionId: string) {
    return this.call<void>("DELETE", `/v1/devices/${encodeURIComponent(id)}/media/streaming/whep/sessions/${encodeURIComponent(sessionId)}`);
  }
}

/** Extract `{id, name?, kind?}` from a JSON:API device list without assuming undocumented fields. */
export function summarizeDevices(body: unknown): Array<{ id: string; attributes: Record<string, unknown> }> {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((d): d is { id: string; attributes?: Record<string, unknown> } => !!d && typeof (d as { id?: unknown }).id === "string")
    .map((d) => ({ id: d.id, attributes: d.attributes ?? {} }));
}
