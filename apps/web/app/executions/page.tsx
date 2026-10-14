"use client";

import Link from "next/link";
import { StatusPill, VerdictMark } from "@/components/Marks";
import { hhmm, upper, usePoll } from "@/lib/client";
import { SOURCE_LABEL, STATUS_ACTION, type ExecutionSummary, type ProtocolView, type WorkflowStatus } from "@/lib/types";

export default function Executions() {
  const { data } = usePoll<ExecutionSummary[]>("/api/executions?limit=100", 2000);
  const { data: protocol } = usePoll<ProtocolView>("/api/protocol", 0);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Executions</h1>
          <p>Every execution, its verdict, and the action applied to the receiving workflow.</p>
        </div>
      </div>
      <div className="panel table-wrap">
        {data?.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Execution</th>
                <th>Opened</th>
                <th>Observed sequence</th>
                <th>Verdict</th>
                <th>Action</th>
                <th>Primary reason</th>
                <th>Source</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.execution_id}>
                  <td>
                    <Link href={`/executions/${e.execution_id}`}>{e.execution_id}</Link>
                    {e.replay?.label && <div className="small muted">{e.replay.label}</div>}
                  </td>
                  <td>{hhmm(e.opened_at)}</td>
                  <td className="small">{e.observed.map((s) => upper(protocol?.labels, s)).join(" › ") || "—"}</td>
                  <td>
                    <VerdictMark verdict={e.verdict} size="sm" />
                  </td>
                  <td>
                    <StatusPill action={STATUS_ACTION[e.workflow_status as WorkflowStatus]} status={e.workflow_status} />
                  </td>
                  <td className="small">{e.system_error ? <span style={{ color: "var(--danger)" }}>{e.system_error.code}</span> : (e.primary_rule ?? e.explanation ?? "—")}</td>
                  <td className="small">{e.source_profiles.map((p) => SOURCE_LABEL[p] ?? p).join(", ")}</td>
                  <td>{e.receipt_id ? <Link href={`/receipts/${e.receipt_id}`}>{e.receipt_id}</Link> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">
            <h2>No executions yet</h2>
            <p style={{ marginTop: 8 }}>
              Executions open when an ARRIVAL observation is accepted. Start one from the <Link href="/monitor">Monitor</Link>.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
