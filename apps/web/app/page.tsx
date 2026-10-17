"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChecklistPlaceholder, DeliveryChecklist } from "@/components/DeliveryChecklist";
import { checklistView, type ChecklistView } from "@/lib/checklist";
import { post, usePoll } from "@/lib/client";
import type { ExecutionDetail, ExecutionSummary, HeroView, ProtocolView } from "@/lib/types";

type Run = { run_id: string; scenario_id: string };

function useRunDetail(runId: string | undefined, list: ExecutionSummary[] | undefined) {
  const id = list?.find((e) => e.replay?.run_id === runId)?.execution_id;
  return usePoll<ExecutionDetail>(id ? `/api/executions/${id}` : null, 600).data;
}

/**
 * The 12-second Obvious Magic walkthrough (Master Brief §5), played over the real results.
 * Captions are built from the two deliveries' own times; nothing is staged.
 */
type Stage = "b-checked" | "b-locked" | "b-order" | "a-order" | "a-unlocked" | "split" | "end";
function script(a: ChecklistView, b: ChecklistView): Array<{ at: number; stage: Stage; caption: string }> {
  const flagged = b.rows.filter((r) => r.flagged);
  const ordered = a.rows.filter((r) => r.signature);
  const pair = (rows: typeof flagged) => rows.map((r) => `${r.label} ${r.at?.slice(11, 16) ?? ""}`).join(", then ");
  return [
    { at: 0, stage: "b-checked", caption: "Every box is checked." },
    { at: 1400, stage: "b-locked", caption: "So why is Release still locked?" },
    { at: 2800, stage: "b-order", caption: flagged.length === 2 ? `Wrong order: ${pair(flagged)}.` : "Wrong order." },
    { at: 5000, stage: "a-order", caption: ordered.length === 2 ? `Right order: ${pair(ordered)}.` : "Right order." },
    { at: 6600, stage: "a-unlocked", caption: "Release unlocked." },
    { at: 8000, stage: "split", caption: "Right order → Release. Wrong order → Hold." },
    { at: 10300, stage: "end", caption: "SEQSEAL. A checklist that can see." },
  ];
}

export default function ChecklistHero() {
  const { data: protocol } = usePoll<ProtocolView>("/api/protocol", 0);
  const { data: hero, refresh } = usePoll<HeroView>("/api/hero", 2000);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  const [stage, setStage] = useState<{ stage: Stage; caption: string } | null>(null);
  const timers = useRef<number[]>([]);
  const { data: list } = usePoll<ExecutionSummary[]>(runs ? "/api/executions?limit=50" : null, 600);
  const liveA = useRunDetail(runs?.[0]?.run_id, list);
  const liveB = useRunDetail(runs?.[1]?.run_id, list);

  const a = runs ? liveA : hero?.a;
  const b = runs ? liveB : hero?.b;
  const va = a && protocol ? checklistView(a, protocol) : undefined;
  const vb = b && protocol ? checklistView(b, protocol) : undefined;
  // Show the source once when both deliveries share it (it is still on every card when they differ).
  const sharedSource = va && vb && va.source === vb.source ? va.source : undefined;
  const canPlay = !!va && !!vb && va.release.tone === "seal" && vb.release.tone === "hold" && !va.active && !vb.active;

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setStage(null);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stop();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, [stop]);

  function play() {
    if (!va || !vb) return;
    stop();
    setOpen({ a: false, b: false });
    for (const s of script(va, vb)) timers.current.push(window.setTimeout(() => setStage({ stage: s.stage, caption: s.caption }), s.at));
    timers.current.push(window.setTimeout(() => setStage(null), 12_000));
  }

  async function replay() {
    stop();
    setBusy(true);
    setError(undefined);
    setOpen({ a: false, b: false });
    const r = await post<{ runs?: Run[]; error?: string }>("/api/demo/winning-moment", {});
    setBusy(false);
    if (!r.ok || !r.body.runs) return setError(r.body.error ?? `The replay could not start (HTTP ${r.status}).`);
    setRuns(r.body.runs);
  }

  async function reset() {
    stop();
    await post("/api/demo/reset", {});
    setRuns(null);
    setOpen({ a: false, b: false });
    refresh();
  }

  const s = stage?.stage;
  const focusA = s === "a-order" || s === "a-unlocked";
  const focusB = s === "b-checked" || s === "b-locked" || s === "b-order";
  const labels = ["Delivery A", "Delivery B"];

  return (
    <>
      <section className="hero-head">
        <p className="hero-context">
          Inbound delivery
          {sharedSource && (
            <span className="hero-source">
              <span className="dot" />
              Source: {sharedSource}
            </span>
          )}
        </p>
        <h1 className="display">Every box is checked. Order still matters.</h1>
        <p className="lede">
          Ring cameras watch the receiving dock. SEQSEAL unlocks <strong>Release delivery</strong> only when the steps really happened in the required order:{" "}
          {protocol ? protocol.expected_sequence.slice(0, 3).map((x) => (protocol.labels[x] ?? x).charAt(0) + (protocol.labels[x] ?? x).slice(1).toLowerCase()).join(", then ") : "Arrival, then Staging, then Storage"}.
        </p>
        <div className="hero-controls">
          <button className="btn" onClick={replay} disabled={busy}>
            {busy ? "Starting" : va || vb ? "Run deliveries A and B again" : "Run deliveries A and B"}
          </button>
          <button className="btn secondary" onClick={stage ? stop : play} disabled={!canPlay && !stage} title={canPlay ? "" : "Available once Delivery A is released and Delivery B is held"}>
            {stage ? "Stop walkthrough" : "Play the 12-second walkthrough"}
          </button>
          <button className="btn quiet" onClick={reset} title="Clear all deliveries from this local demo">
            Clear results
          </button>
        </div>
      </section>

      {error && <p className="notice error">{error}</p>}

      <div className={`checklists${s ? ` stage-${s}` : ""}`} aria-live="polite">
        {stage && (
          <p className="walkthrough-caption" role="status">
            {stage.caption}
          </p>
        )}
        <div className={`checklist-slot${focusB ? " dim" : ""}`}>
          {va ? (
            <DeliveryChecklist title={labels[0]!} view={va} showSource={!sharedSource} expanded={open.a} onToggle={() => setOpen((o) => ({ ...o, a: !o.a }))} emphasize={focusA || s === "split"} />
          ) : (
            <ChecklistPlaceholder title={labels[0]!} note={runs ? "Waiting for the first Ring observation" : "No delivery yet"} />
          )}
        </div>
        <div className={`checklist-slot${focusA ? " dim" : ""}`}>
          {vb ? (
            <DeliveryChecklist title={labels[1]!} view={vb} showSource={!sharedSource} expanded={open.b} onToggle={() => setOpen((o) => ({ ...o, b: !o.b }))} emphasize={s === "b-order" || s === "split"} />
          ) : (
            <ChecklistPlaceholder title={labels[1]!} note={runs ? "Waiting for the first Ring observation" : va?.active ? "Waiting for the next delivery" : "No delivery yet"} />
          )}
        </div>
      </div>

      <p className="hero-line">Same observations. Different sequence. Different operational action.</p>
      <p className="hero-sub">
        Press a Release button to see why it is locked or unlocked: the exact protocol rule, what was observed, and the Ring evidence behind it. AI can propose evidence; it cannot release a delivery.
      </p>
    </>
  );
}
