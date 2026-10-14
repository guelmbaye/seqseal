"use client";

import Link from "next/link";
import { useState } from "react";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import type { LaneStep } from "@/components/SequenceLanes";
import { hhmmss, post, usePoll } from "@/lib/client";
import type { DomainEvent, ExecutionDetail, ExecutionSummary, ProtocolView, ScenarioInfo } from "@/lib/types";

const RUN_LABEL: Record<string, string> = {
  "correct-sequence": "Run correct sequence",
  "wrong-sequence": "Run wrong sequence",
  "missing-evidence": "Run missing evidence",
  "ambiguous-evidence": "Run ambiguous evidence",
};

const INTEGRITY_TEXT: Record<string, string> = {
  VALID_SO_FAR: "Valid so far",
  WAITING_FOR_EVIDENCE: "Waiting for evidence",
  POTENTIAL_ORDER_VIOLATION: "Potential order violation",
  DEVIATION_DETECTED: "Deviation detected",
  EVIDENCE_UNRESOLVED: "Evidence unresolved",
  VERIFIED: "Verified",
};

export default function Monitor() {
  const { data: protocol } = usePoll<ProtocolView>("/api/protocol", 0);
  const { data: scenarios } = usePoll<ScenarioInfo[]>("/api/scenarios", 0);
  const { data: list } = usePoll<ExecutionSummary[]>("/api/executions?limit=20", 800);
  const { data: events } = usePoll<DomainEvent[]>("/api/events?limit=30", 1200);
  const latest = list ? [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] : undefined;
  const { data: detail } = usePoll<ExecutionDetail>(latest ? `/api/executions/${latest.execution_id}` : null, 800);
  const [drawer, setDrawer] = useState<LaneStep>();
  const [msg, setMsg] = useState<string>();

  async function run(id: string) {
    setMsg(undefined);
    const r = await post<{ error?: string }>("/api/demo/run", { scenario: id });
    if (!r.ok) setMsg(r.body.error ?? `HTTP ${r.status}`);
  }
  async function close(id: string) {
    await post("/api/demo/finalize", { execution_id: id });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monitor</h1>
          <p>Executions update as source evidence arrives. Demo controls replay source events; they never set a verdict.</p>
        </div>
        <div className="btn-row">
          {(scenarios ?? []).map((s) => (
            <button key={s.id} className="btn secondary" onClick={() => run(s.id)} title={s.description}>
              {RUN_LABEL[s.id] ?? `Run ${s.id}`}
            </button>
          ))}
        </div>
      </div>
      {msg && <p className="notice error">{msg}</p>}

      <div className="split">
        <div>
          {detail && protocol ? (
            <>
              <div className="panel-head">
                <span className="small muted">
                  Current integrity: <strong style={{ color: "var(--ink)" }}>{INTEGRITY_TEXT[detail.evaluation?.integrity_state ?? ""] ?? "Waiting for evidence"}</strong>
                </span>
                {detail.execution.status === "ACTIVE" && (
                  <button className="btn secondary" onClick={() => close(detail.execution.execution_id)}>
                    Close execution now
                  </button>
                )}
              </div>
              <ExecutionPanel detail={detail} protocol={protocol} live={detail.execution.status === "ACTIVE"} onSelectStep={setDrawer} />
            </>
          ) : (
            <div className="panel empty">
              <h2>No active workflow</h2>
              <p style={{ marginTop: 8 }}>Waiting for Ring observations. Start a scenario above, send a signed webhook, or capture from the Ring Developer Playground.</p>
            </div>
          )}
        </div>
        <aside className="panel">
          <div className="panel-head">
            <h3>Pipeline activity</h3>
            <span className="small muted">Domain events, newest first</span>
          </div>
          <ul className="timeline">
            {(events ?? []).map((e) => (
              <li key={e.event_id}>
                <time>{hhmmss(e.occurred_at)}</time>
                <span>
                  <strong>{e.name}</strong>
                  {e.execution_id && (
                    <>
                      {" "}
                      <Link href={`/executions/${e.execution_id}`}>{e.execution_id}</Link>
                    </>
                  )}
                  {typeof e.payload.verdict === "string" && <span className="muted"> {String(e.payload.verdict)}</span>}
                  {typeof e.payload.action === "string" && <span className="muted"> {String(e.payload.action)}</span>}
                  {typeof e.payload.state === "string" && <span className="muted"> {String(e.payload.state).toUpperCase()}</span>}
                  {typeof e.payload.code === "string" && <span style={{ color: "var(--danger)" }}> {String(e.payload.code)}</span>}
                </span>
              </li>
            ))}
            {!events?.length && <li className="muted">No events yet.</li>}
          </ul>
        </aside>
      </div>
      {drawer && detail && protocol && <EvidenceDrawer detail={detail} protocol={protocol} step={drawer} onClose={() => setDrawer(undefined)} />}
    </>
  );
}
