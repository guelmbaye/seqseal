import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Ring webhook authentication.
 *
 * Ring signs the RAW request body with HMAC-SHA256 using the partner signing key and
 * sends `X-Signature: sha256=<hex>`. Verification MUST run over the raw bytes — never
 * over re-serialized JSON — and MUST use a constant-time comparison.
 * Source: https://developer.amazon.com/docs/ring/notifications.html
 */
export const RING_SIGNATURE_HEADER = "x-signature";

export function computeRingSignature(rawBody: string | Uint8Array, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyRingSignature(rawBody: string | Uint8Array, header: string | undefined | null, secret: string): boolean {
  if (!header || !secret) return false;
  const provided = header.trim().replace(/^sha256=/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(provided, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Case-insensitive header lookup (API Gateway may lowercase or preserve case). */
export function headerValue(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return v;
  return undefined;
}
