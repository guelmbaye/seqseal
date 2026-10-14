/** Canonical artifact storage: S3 on AWS, memory locally (Doc 06 §34). */
export interface ArtifactStore {
  putJson(key: string, value: unknown): Promise<void>;
  getJson<T>(key: string): Promise<T | undefined>;
}

export class InMemoryArtifactStore implements ArtifactStore {
  private readonly objects = new Map<string, string>();
  async putJson(key: string, value: unknown) {
    this.objects.set(key, JSON.stringify(value));
  }
  async getJson<T>(key: string) {
    const v = this.objects.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  keys() {
    return [...this.objects.keys()];
  }
}
