/**
 * Send a signed, documented-shape Ring webhook to a SEQSEAL endpoint (local or deployed).
 * Useful for staging tests of the production webhook path (HMAC over raw bytes).
 *
 *   pnpm sign-webhook --url https://<api>/integrations/ring/webhook --secret <signing-secret> \
 *        --device ring-device-staging --type motion_detected --subtype package_delivery [--at 2026-10-18T14:03:00Z] [--dry-run]
 */
import { randomUUID } from "node:crypto";
import { buildRingWebhookEnvelope, computeRingSignature } from "@seqseal/ring-adapter";

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const url = arg("url");
const secret = arg("secret", process.env.RING_WEBHOOK_SIGNING_SECRET ?? "");
const device = arg("device", "ring-device-entry")!;
const type = arg("type", "motion_detected")!;
const subtype = arg("subtype");
const at = Date.parse(arg("at", new Date().toISOString())!);

const env = buildRingWebhookEnvelope({ request_id: `req-${randomUUID()}`, device_id: device, event_type: type, ...(subtype ? { sub_type: subtype } : {}), occurred_at_ms: at });
const body = JSON.stringify(env);
const signature = computeRingSignature(body, secret ?? "");

if (!url || process.argv.includes("--dry-run")) {
  console.log(`X-Signature: ${signature}\n${body}`);
  console.log(`\ncurl -sS -X POST '${url ?? "http://localhost:3000/integrations/ring/webhook"}' -H 'content-type: application/json' -H 'X-Signature: ${signature}' --data '${body}'`);
} else {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "X-Signature": signature }, body });
  console.log(res.status, await res.text());
}
