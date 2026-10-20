import { timingSafeEqual } from "node:crypto";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const cache = new Map<string, { value: string; at: number }>();
const TTL_MS = 5 * 60_000;
let client: SecretsManagerClient | undefined;

/** Secrets never live in code, Terraform values, logs or the frontend (Doc 06 §37). */
export async function getSecret(arn: string | undefined): Promise<string> {
  if (!arn) return "";
  const hit = cache.get(arn);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  client ??= new SecretsManagerClient({});
  let value = "";
  try {
    const r = await client.send(new GetSecretValueCommand({ SecretId: arn }));
    value = r.SecretString ?? "";
  } catch (err) {
    // Terraform creates the secret containers without a value. Until `put-secret-value` runs,
    // the secret reads as "not configured": callers fail closed (401/503) instead of crashing.
    // Any other error (AccessDenied above all) is a deployment fault and is rethrown.
    if ((err as { name?: string }).name !== "ResourceNotFoundException") throw err;
    console.warn(JSON.stringify({ level: "warn", msg: "secret_not_set", secret: arn.split(":").pop() }));
  }
  cache.set(arn, { value, at: Date.now() });
  return value;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
