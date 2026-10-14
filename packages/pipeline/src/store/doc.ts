/**
 * Minimal document-table abstraction shared by the in-memory store (local demo, tests,
 * benchmark) and DynamoDB (AWS). Domain logic is written once against this interface,
 * so the replay fallback exercises exactly the same code as the deployed pipeline.
 */
export type TableName = "executions" | "evidence" | "config" | "idempotency";

export interface DocItem {
  pk: string;
  sk: string;
  [key: string]: unknown;
}

export interface Condition {
  attr: string;
  /** eq / ne compare to value; `absentOrLt` passes when attr is missing or < value. */
  op: "eq" | "ne" | "absentOrLt" | "absentOrEq";
  value: unknown;
}

export interface PutOptions {
  ifNotExists?: boolean;
  condition?: Condition;
}

export interface QueryOptions {
  prefix?: string;
  limit?: number;
  descending?: boolean;
}

export interface DocTable {
  get(pk: string, sk: string): Promise<DocItem | undefined>;
  /** Returns false (never throws) when a condition fails. */
  put(item: DocItem, opts?: PutOptions): Promise<boolean>;
  query(pk: string, opts?: QueryOptions): Promise<DocItem[]>;
  delete(pk: string, sk: string, opts?: { condition?: Condition }): Promise<boolean>;
  /** Atomic counter. */
  increment(pk: string, sk: string, attr: string, by?: number): Promise<number>;
}

export interface DocDatabase {
  table(name: TableName): DocTable;
}

export function conditionHolds(current: DocItem | undefined, c: Condition): boolean {
  const v = current?.[c.attr];
  switch (c.op) {
    case "eq":
      return current !== undefined && v === c.value;
    case "ne":
      return current === undefined || v !== c.value;
    case "absentOrLt":
      return v === undefined || (typeof v === "number" && typeof c.value === "number" && v < c.value);
    case "absentOrEq":
      return v === undefined || v === c.value;
  }
}

class MemoryTable implements DocTable {
  private readonly items = new Map<string, Map<string, DocItem>>();

  async get(pk: string, sk: string) {
    const it = this.items.get(pk)?.get(sk);
    return it ? structuredClone(it) : undefined;
  }

  async put(item: DocItem, opts: PutOptions = {}) {
    const current = this.items.get(item.pk)?.get(item.sk);
    if (opts.ifNotExists && current) return false;
    if (opts.condition && !conditionHolds(current, opts.condition)) return false;
    if (!this.items.has(item.pk)) this.items.set(item.pk, new Map());
    this.items.get(item.pk)!.set(item.sk, structuredClone(item));
    return true;
  }

  async query(pk: string, opts: QueryOptions = {}) {
    const part = this.items.get(pk);
    if (!part) return [];
    let rows = [...part.values()].filter((i) => !opts.prefix || i.sk.startsWith(opts.prefix));
    rows.sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
    if (opts.descending) rows = rows.reverse();
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows.map((r) => structuredClone(r));
  }

  async delete(pk: string, sk: string, opts: { condition?: Condition } = {}) {
    const current = this.items.get(pk)?.get(sk);
    if (opts.condition && !conditionHolds(current, opts.condition)) return false;
    return this.items.get(pk)?.delete(sk) ?? false;
  }

  async increment(pk: string, sk: string, attr: string, by = 1) {
    const current = this.items.get(pk)?.get(sk) ?? { pk, sk };
    const next = (typeof current[attr] === "number" ? (current[attr] as number) : 0) + by;
    if (!this.items.has(pk)) this.items.set(pk, new Map());
    this.items.get(pk)!.set(sk, { ...current, [attr]: next });
    return next;
  }
}

export class InMemoryDocDatabase implements DocDatabase {
  private readonly tables = new Map<TableName, MemoryTable>();
  table(name: TableName): DocTable {
    if (!this.tables.has(name)) this.tables.set(name, new MemoryTable());
    return this.tables.get(name)!;
  }
}
