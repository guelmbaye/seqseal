import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Condition, DocDatabase, DocItem, DocTable, PutOptions, QueryOptions, TableName } from "@seqseal/pipeline";

/**
 * DynamoDB implementation of the generic document tables (Doc 06 §30–32).
 * Every conditional write maps 1:1 to the in-memory semantics so the local
 * runtime and the deployed pipeline share exactly the same domain code.
 */
function conditionExpression(c: Condition): { expr: string; names: Record<string, string>; values: Record<string, unknown> } {
  const names = { "#c": c.attr };
  switch (c.op) {
    case "eq":
      return { expr: "#c = :c", names, values: { ":c": c.value } };
    case "ne":
      return { expr: "attribute_not_exists(#c) OR #c <> :c", names, values: { ":c": c.value } };
    case "absentOrLt":
      return { expr: "attribute_not_exists(#c) OR #c < :c", names, values: { ":c": c.value } };
    case "absentOrEq":
      return c.value === undefined
        ? { expr: "attribute_not_exists(#c)", names, values: {} }
        : { expr: "attribute_not_exists(#c) OR #c = :c", names, values: { ":c": c.value } };
  }
}

type Sender = Pick<DynamoDBDocumentClient, "send">;

class DynamoTable implements DocTable {
  constructor(
    private readonly doc: Sender,
    private readonly tableName: string,
  ) {}

  async get(pk: string, sk: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }));
    return r.Item as DocItem | undefined;
  }

  async put(item: DocItem, opts: PutOptions = {}) {
    let ConditionExpression: string | undefined;
    let names: Record<string, string> = {};
    let values: Record<string, unknown> = {};
    if (opts.ifNotExists) ConditionExpression = "attribute_not_exists(pk)";
    else if (opts.condition) {
      const c = conditionExpression(opts.condition);
      ConditionExpression = c.expr;
      names = c.names;
      values = c.values;
    }
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ...(ConditionExpression ? { ConditionExpression } : {}),
          ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
          ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException || (err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  async query(pk: string, opts: QueryOptions = {}) {
    const out: DocItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: opts.prefix ? "pk = :pk AND begins_with(sk, :p)" : "pk = :pk",
          ExpressionAttributeValues: { ":pk": pk, ...(opts.prefix ? { ":p": opts.prefix } : {}) },
          ScanIndexForward: !opts.descending,
          ConsistentRead: true,
          ...(opts.limit ? { Limit: opts.limit - out.length } : {}),
          ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}),
        }),
      );
      out.push(...((r.Items ?? []) as DocItem[]));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && (!opts.limit || out.length < opts.limit));
    return out;
  }

  async delete(pk: string, sk: string, opts: { condition?: Condition } = {}) {
    try {
      const c = opts.condition ? conditionExpression(opts.condition) : undefined;
      await this.doc.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          ...(c ? { ConditionExpression: c.expr, ExpressionAttributeNames: c.names, ...(Object.keys(c.values).length ? { ExpressionAttributeValues: c.values } : {}) } : {}),
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw err;
    }
  }

  async increment(pk: string, sk: string, attr: string, by = 1) {
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: "ADD #a :by",
        ExpressionAttributeNames: { "#a": attr },
        ExpressionAttributeValues: { ":by": by },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number((r.Attributes ?? {})[attr]);
  }
}

export interface TableNames {
  executions: string;
  evidence: string;
  config: string;
  idempotency: string;
}

export function tableNamesFromEnv(env = process.env): TableNames {
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing environment variable ${k}`);
    return v;
  };
  return {
    executions: need("SEQSEAL_TABLE_EXECUTIONS"),
    evidence: need("SEQSEAL_TABLE_EVIDENCE"),
    config: need("SEQSEAL_TABLE_CONFIG"),
    idempotency: need("SEQSEAL_TABLE_IDEMPOTENCY"),
  };
}

export class DynamoDocDatabase implements DocDatabase {
  private readonly doc: Sender;
  private readonly tables = new Map<TableName, DynamoTable>();
  /** `docClient` is injectable for tests; production uses a DocumentClient that drops undefined values. */
  constructor(
    private readonly names: TableNames,
    docClient?: Sender,
  ) {
    this.doc = docClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false } });
  }
  table(name: TableName): DocTable {
    if (!this.tables.has(name)) this.tables.set(name, new DynamoTable(this.doc, this.names[name]));
    return this.tables.get(name)!;
  }
}
