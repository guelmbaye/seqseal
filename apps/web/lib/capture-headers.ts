/**
 * Headers that say where a Playground capture comes from (scripts/replay.ts --captures sets them).
 * In remote mode the console forwards them to the deployed API: without them, a replayed session
 * would be ingested on AWS as a live Ring Developer Playground capture.
 */
const PROVENANCE_HEADERS = ["x-seqseal-source-profile", "x-seqseal-replay-run"] as const;

export function provenanceHeaders(headers: Record<string, string>): Record<string, string> {
  const byName = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const out: Record<string, string> = {};
  for (const name of PROVENANCE_HEADERS) {
    const value = byName.get(name);
    if (value) out[name] = value;
  }
  return out;
}
