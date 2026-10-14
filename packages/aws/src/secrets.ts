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
  const r = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const value = r.SecretString ?? "";
  cache.set(arn, { value, at: Date.now() });
  return value;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
