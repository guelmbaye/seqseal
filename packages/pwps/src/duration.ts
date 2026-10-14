/**
 * ISO 8601 durations, restricted to unambiguous designators (D, H, M, S).
 * Years and months are rejected: their length is calendar-dependent and
 * therefore not deterministic.
 */
const DURATION_RE = /^P(?!$)(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?)?$/;

const MS = { D: 86_400_000, H: 3_600_000, M: 60_000, S: 1_000 } as const;

export function parseDuration(value: string): number | null {
  const m = DURATION_RE.exec(value);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * MS.D +
    Number(h ?? 0) * MS.H +
    Number(min ?? 0) * MS.M +
    Math.round(Number(s ?? 0) * MS.S)
  );
}

/** Canonical form: largest units first, no zero components. `PT300S` → `PT5M`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "PT0S";
  let rest = ms;
  const days = Math.floor(rest / MS.D);
  rest -= days * MS.D;
  const hours = Math.floor(rest / MS.H);
  rest -= hours * MS.H;
  const minutes = Math.floor(rest / MS.M);
  rest -= minutes * MS.M;
  const seconds = rest / MS.S;
  let out = "P";
  if (days) out += `${days}D`;
  if (hours || minutes || seconds) {
    out += "T";
    if (hours) out += `${hours}H`;
    if (minutes) out += `${minutes}M`;
    if (seconds) out += `${Number(seconds.toFixed(3))}S`;
  }
  return out;
}

export function humanizeDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 60_000) return `${Math.round(abs / 1000)} s`;
  const minutes = abs / 60_000;
  if (minutes < 60) return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
}
