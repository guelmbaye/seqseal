"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function usePoll<T>(url: string | null, intervalMs = 1500): { data: T | undefined; error: string | undefined; refresh: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!alive || urlRef.current !== url) return;
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        else {
          setError(undefined);
          setData(body as T);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = intervalMs > 0 ? setInterval(load, intervalMs) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [url, intervalMs, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, refresh };
}

export async function post<T = unknown>(url: string, body: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

/** HH:MM (UTC) — never locale dependent, matches receipts. */
export function hhmm(iso?: string): string {
  return iso ? iso.slice(11, 16) : "—";
}
export function hhmmss(iso?: string): string {
  return iso ? iso.slice(11, 19) : "—";
}
export function upper(labels: Record<string, string> | undefined, state: string): string {
  return labels?.[state] ?? state.toUpperCase();
}
export function shortHash(h?: string, n = 12): string {
  return h ? `${h.slice(0, 7 + n)}…` : "—";
}
