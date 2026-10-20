import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

/**
 * Minimal DynamoDB emulator for the exact expression grammar DynamoDocDatabase emits.
 * Lets the REAL pipeline run on the REAL DynamoDB adapter code, so condition-expression
 * translation (idempotency, lane locks, optimistic concurrency) is verified end to end.
 */
export class FakeDynamo {
  tables = new Map<string, Map<string, Record<string, unknown>>>();
  calls: string[] = [];
  private t(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }
  private holds(item: Record<string, unknown> | undefined, expr: string | undefined, names: Record<string, string> = {}, values: Record<string, unknown> = {}) {
    if (!expr) return true;
    return expr.split(" OR ").some((atom) => {
      const a = atom.trim();
      const ne = /^attribute_not_exists\((#?\w+)\)$/.exec(a);
      if (ne) {
        const attr = ne[1]!.startsWith("#") ? names[ne[1]!]! : ne[1]!;
        return item === undefined || item[attr] === undefined;
      }
      const cmp = /^(#\w+) (=|<>|<) (:\w+)$/.exec(a);
      if (!cmp || !item) return false;
      const v = item[names[cmp[1]!]!];
      const w = values[cmp[3]!];
      return cmp[2] === "=" ? v === w : cmp[2] === "<>" ? v !== w : (v as number) < (w as number);
    });
  }
  async send(cmd: unknown) {
    const input = (cmd as { input: Record<string, never> }).input as Record<string, unknown>;
    const table = this.t(String(input.TableName));
    const key = (k: { pk: string; sk: string }) => `${k.pk}\u0000${k.sk}`;
    const fail = () => Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
    if (cmd instanceof GetCommand) {
      this.calls.push("Get");
      const it = table.get(key(input.Key as { pk: string; sk: string }));
      return { Item: it ? structuredClone(it) : undefined };
    }
    if (cmd instanceof PutCommand) {
      this.calls.push("Put");
      const item = JSON.parse(JSON.stringify(input.Item)) as { pk: string; sk: string };
      if (!this.holds(table.get(key(item)), input.ConditionExpression as string, input.ExpressionAttributeNames as Record<string, string>, input.ExpressionAttributeValues as Record<string, unknown>)) throw fail();
      table.set(key(item), item);
      return {};
    }
    if (cmd instanceof DeleteCommand) {
      const k = key(input.Key as { pk: string; sk: string });
      if (!this.holds(table.get(k), input.ConditionExpression as string, input.ExpressionAttributeNames as Record<string, string>, input.ExpressionAttributeValues as Record<string, unknown>)) throw fail();
      table.delete(k);
      return {};
    }
    if (cmd instanceof UpdateCommand) {
      const k = key(input.Key as { pk: string; sk: string });
      const attr = (input.ExpressionAttributeNames as Record<string, string>)["#a"]!;
      const cur = table.get(k) ?? { ...(input.Key as object) };
      const next = { ...cur, [attr]: ((cur as Record<string, number>)[attr] ?? 0) + (input.ExpressionAttributeValues as Record<string, number>)[":by"]! };
      table.set(k, next);
      return { Attributes: { [attr]: next[attr] } };
    }
    if (cmd instanceof QueryCommand) {
      const v = input.ExpressionAttributeValues as Record<string, string>;
      let rows = [...table.values()].filter((r) => r.pk === v[":pk"] && (!v[":p"] || String(r.sk).startsWith(v[":p"])));
      rows.sort((a, b) => (String(a.sk) < String(b.sk) ? -1 : 1));
      if (input.ScanIndexForward === false) rows = rows.reverse();
      if (input.Limit) rows = rows.slice(0, input.Limit as number);
      return { Items: rows.map((r) => structuredClone(r)) };
    }
    throw new Error(`unsupported command ${String(cmd)}`);
  }
}
