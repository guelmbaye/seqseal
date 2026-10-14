import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ArtifactStore } from "@seqseal/pipeline";

/** Canonical artifacts (receipts, evaluation snapshots, minimal media) in a private, KMS-encrypted bucket. */
export class S3ArtifactStore implements ArtifactStore {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}

  async putJson(key: string, value: unknown) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
  }

  async getJson<T>(key: string): Promise<T | undefined> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(await r.Body!.transformToString()) as T;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  async putBytes(key: string, bytes: Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }

  async getBytes(key: string): Promise<Uint8Array | undefined> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await r.Body!.transformToByteArray();
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey" || (err as { name?: string }).name === "AccessDenied") return undefined;
      throw err;
    }
  }
}
