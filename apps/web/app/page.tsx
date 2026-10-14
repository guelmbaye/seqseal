"use client";

import { useState } from "react";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { ExecutionPanel } from "@/components/ExecutionPanel";
import type { LaneStep } from "@/components/SequenceLanes";
import { post, upper, usePoll } from "@/lib/client";
import type { ExecutionDetail, ExecutionSummary, ProtocolView } from "@/lib/types";

type Hero = { sealed?: ExecutionDetail; deviated?: ExecutionDetail; same_protocol: boolean; same_policy: boolean };
type Run = { run_id: string; scenario_id: string };

function useRunDetail(runId: string | undefined, list: ExecutionSummary[] | undefined) {
  const id = list?.find((e) => e.replay?.run_id === runId)?.execution_id;
  return usePoll<ExecutionDetail>(id ? `/api/executions/${id}` : null, 700).data;
}

export default function WinningMoment() {
  const { data: protocol } = usePoll<ProtocolView>("/api/protocol", 0);
  const { data: hero, refresh } = usePoll<Hero>("/api/hero", 2500);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [drawer, setDrawer] = useState<{ detail: ExecutionDetail; step: LaneStep }>();
  const { data: list } = usePoll<ExecutionSummary[]>(runs ? "/api/executions?limit=50" : null, 700);
  const liveA = useRunDetail(runs?.[0]?.run_id, list);
  const liveB = useRunDetail(runs?.[1]?.run_id, list);

  const a = runs ? liveA : hero?.sealed;
  const b = runs ? liveB : hero?.deviated;

  async function runWinningMoment() {
    setBusy(true);
    setError(undefined);
    const r = await post<{ runs?: Run[]; error?: string }>("/api/demo/winning-moment", {});
    setBusy(false);
    if (!r.ok || !r.body.runs) return setError(r.body.error ?? `Could not start the replay (HTTP ${r.status}).`);
    setRuns(r.body.runs);
  }

  async function reset() {
    await post("/api/demo/reset", {});
    setRuns(null);
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 style={{ maxWidth: "24ch" }}>These two deliveries contain the same events. Only one should be released.</h1>
          <p>Each execution is evaluated against the same PWPS protocol and the same action policy. Only the physical order of the Ring observations differs.</p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={runWinningMoment} disabled={busy}>
            {busy ? "Starting replay" : "Run the Winning Moment"}
          </button>
          <button className="btn secondary" onClick={reset}>
            Reset demo
          </button>
        </div>
      </div>

      {protocol && (
        <div className="hero-protocol">
          <span className="small muted">Required receiving sequence, {protocol.ref}</span>
          <div className="btn-row" aria-label="Required sequence">
            {protocol.expected_sequence.map((s, i) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {i > 0 && <span className="muted" aria-hidden="true">›</span>}
                <span className="token">{upper(protocol.labels, s)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {error && <p className="notice error">{error}</p>}

      {protocol && (a || b) ? (
        <div className="hero-grid">
          {a ? (
            <ExecutionPanel detail={a} protocol={protocol} title="Execution A" live={!!runs} onSelectStep={(step) => setDrawer({ detail: a, step })} />
          ) : (
            <Placeholder label="Execution A" />
          )}
          {b ? (
            <ExecutionPanel detail={b} protocol={protocol} title="Execution B" live={!!runs} onSelectStep={(step) => setDrawer({ detail: b, step })} />
          ) : (
            <Placeholder label="Execution B" />
          )}
        </div>
      ) : (
        <div className="panel empty">
          <h2>No executions yet</h2>
          <p style={{ marginTop: 8 }}>
            Run the Winning Moment to replay Execution A and Execution B through the full pipeline: Ring-shaped source events, evidence mapping, PWPS evaluation, the action policy and the Operational Gate.
          </p>
        </div>
      )}

      <p className="hero-line">Same observations. Different sequence. Different operational action.</p>
      <p className="hero-sub">Ring observes. PWPS defines. SEQSEAL verifies the sequence and gates what the receiving workflow may do next. AI can propose evidence; it cannot seal or release a workflow.</p>

      {drawer && protocol && <EvidenceDrawer detail={drawer.detail} protocol={protocol} step={drawer.step} onClose={() => setDrawer(undefined)} />}
    </>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <section className="exec-panel" aria-busy="true">
      <h2 style={{ fontSize: "1.25rem" }}>{label}</h2>
      <p className="muted">Waiting for the first Ring observation.</p>
    </section>
  );
}
