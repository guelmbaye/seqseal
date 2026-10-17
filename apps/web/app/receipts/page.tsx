"use client";

import Link from "next/link";
import { VerdictMark } from "@/components/Marks";
import { hhmmss, shortHash, usePoll } from "@/lib/client";
import type { SeqSealReceipt } from "@/lib/types";

export default function Receipts() {
  const { data } = usePoll<SeqSealReceipt[]>("/api/receipts?limit=100", 3000);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Receipts</h1>
          <p>Every finalized decision, linked to the protocol, the policy, the rule results and the Ring-derived evidence that produced it.</p>
        </div>
      </div>
      <div className="panel table-wrap">
        {data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Execution</th>
                <th>Verdict</th>
                <th>Action</th>
                <th>Primary rule</th>
                <th>Generated</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.receipt_id}>
                  <td>
                    <Link href={`/receipts/${r.receipt_id}`}>{r.receipt_id}</Link>
                    {r.supersedes && <div className="small muted">supersedes {r.supersedes}</div>}
                  </td>
                  <td>
                    <Link href={`/executions/${r.execution_id}`}>{r.execution_id}</Link>
                  </td>
                  <td>
                    <VerdictMark verdict={r.verdict} size="sm" />
                  </td>
                  <td>
                    <strong>{r.operational_action}</strong>
                    {!r.operational.applied && <span style={{ color: "var(--danger)" }}> not applied</span>}
                  </td>
                  <td>{r.primary_failures[0] ?? "—"}</td>
                  <td>{hhmmss(r.generated_at)}</td>
                  <td className="mono small">{shortHash(r.receipt_hash, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <h2>No receipts yet</h2>
            <p style={{ marginTop: 8 }}>A receipt is generated when the Operational Gate applies a final action.</p>
          </div>
        )}
      </div>
    </>
  );
}
