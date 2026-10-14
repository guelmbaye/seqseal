"use client";

import Link from "next/link";
import { use, useState } from "react";
import { EvidenceDrawer } from "@/components/EvidenceDrawer";
import { laneData, workflowAction } from "@/components/ExecutionPanel";
import { ActionBlock, StatusPill, VerdictMark } from "@/components/Marks";
import { SequenceLanes, type LaneStep } from "@/components/SequenceLanes";
import { hhmmss, post, shortHash, upper, usePoll } from "@/lib/client";
import { SOURCE_LABEL, STATUS_ACTION, type ExecutionDetail, type ProtocolView, type WorkflowStatus } from "@/lib/types";

export default function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: d, error, refresh } = usePoll<ExecutionDetail>(`/api/executions/${id}`, 1500);
  const { data: protocol } = usePoll<ProtocolView>("/api/protocol", 0);
  const [drawer, setDrawer] = useState<LaneStep>();
  const [note, setNote] = useState<string>();

  if (error) return <p className="notice error">Execution {id} could not be loaded: {error}</p>;
  if (!d || !protocol) return <p className="muted">Loading {id}</p>;

  const ev = d.evaluation;
  const action = workflowAction(d);
  const { observed, violated, missing } = laneData(d);
  const decision = d.decisions.at(-1);
  const unresolved = d.candidates.filter((c) => c.status === "UNCERTAIN" || c.status === "MEDIA_PENDING");

  async function review(candidate_id: string, actionName: "CONFIRM" | "REJECT" | "LEAVE_UNRESOLVED") {
    const r = await post<{ error?: string }>("/api/reviews", { candidate_id, action: actionName, reviewer_ref: "site-supervisor" });
    setNote(r.ok ? (actionName === "LEAVE_UNRESOLVED" ? "Review recorded; evidence stays unresolved." : "Evidence updated. The engine re-evaluated the protocol.") : (r.body.error ?? `HTTP ${r.status}`));
    refresh();
  }
  async function close() {
    await post("/api/demo/finalize", { execution_id: id });
    refresh();
  }

  return (
    <>
      <p className="small">
        <Link href="/executions">Executions</Link> / {id}
      </p>

      {/* 1 — Decision header: action first, then verdict, then plain-language reason */}
      <div className="split" style={{ marginTop: 10 }}>
        <div className="panel">
          <div className="panel-head">
            <h1 style={{ fontSize: "1.9rem" }}>{id}</h1>
            <span className="source-chip">
              <span className="dot" />
              Source <strong>{d.execution.source_profiles.map((p) => SOURCE_LABEL[p] ?? p).join(", ") || "—"}</strong>
            </span>
          </div>
          <ActionBlock action={action} pending={ev?.explanation} />
          <div className="chain-step" style={{ marginTop: 14 }}>
            <VerdictMark verdict={ev?.verdict} />
            <span className="small muted">
              {ev?.mode === "FINAL" ? "final" : "provisional"} evaluation {ev?.evaluation_id}
            </span>
          </div>
          <p style={{ marginTop: 8 }}>{ev?.explanation ?? "No evaluation yet."}</p>
          {d.execution.system_error && (
            <p className="notice error" style={{ marginTop: 12 }}>
              Verification unavailable ({d.execution.system_error.code}): {d.execution.system_error.message}. The workflow is not released.
            </p>
          )}
          {d.execution.status === "ACTIVE" && (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="btn secondary" onClick={close}>
                Close execution now
              </button>
              <span className="small muted">Finalizes with the evidence received so far. Missing evidence stays missing.</span>
            </div>
          )}
        </div>

        {/* Operational Gate: verdict → policy → action → event */}
        <div className="panel">
          <h3>Operational gate</h3>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Input verdict</dt>
            <dd>{ev?.verdict ?? "—"}</dd>
            <dt>Policy</dt>
            <dd>{decision ? `${decision.action_policy_id} ${decision.action_policy_version}` : "—"}</dd>
            <dt>Mapping applied</dt>
            <dd>{decision ? `${decision.verdict} to ${decision.action}` : "—"}</dd>
            <dt>Output</dt>
            <dd>{decision?.action ?? "—"}</dd>
            <dt>Decision</dt>
            <dd className="mono">{decision?.decision_id ?? "—"}</dd>
            <dt>Workflow</dt>
            <dd>
              <StatusPill action={action} status={d.workflow?.status} />
            </dd>
          </dl>
          <ul className="timeline" style={{ marginTop: 14 }}>
            {(d.workflow?.history ?? [])
              .filter((h, i, all) => h.from !== h.to || i === all.length - 1)
              .map((h) => (
              <li key={h.decision_id}>
                <time>{hhmmss(h.at)}</time>
                <span>
                  {h.from} to <strong>{h.to}</strong> {h.event_type ? `(${h.event_type})` : "(no change event)"}
                  <span className="muted"> {h.final ? "final" : "provisional"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* 2 — Expected vs observed */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Expected versus observed</h2>
          <span className="small muted">Select an observed step to open its Ring evidence</span>
        </div>
        <SequenceLanes expected={ev?.expected_sequence ?? protocol.expected_sequence} labels={protocol.labels} observed={observed} violated={violated} missing={d.execution.status === "FINALIZED" ? missing : []} onSelect={setDrawer} />
      </div>

      {/* 3 — Why */}
      <div className="split" style={{ marginTop: 16 }}>
        <div className="panel table-wrap">
          <h2>Why</h2>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Result</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {(ev?.rule_results ?? []).map((r) => (
                <tr key={r.rule_id}>
                  <td>
                    <strong>{r.rule_id}</strong>
                  </td>
                  <td>
                    <span className={`status-pill ${r.status === "PASS" ? "tone-seal" : r.status === "FAIL" ? "tone-hold" : "tone-wait"}`}>{r.status.replace("_", " ")}</span>
                  </td>
                  <td className="small">{r.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ev?.counterfactual && (
            <p className="rule-callout ok" style={{ marginTop: 14 }}>
              <strong>What would change the result?</strong> {ev.counterfactual.statement} With all other rules unchanged, the verdict would be {ev.counterfactual.verdict_if_changed}.
            </p>
          )}
        </div>

        <div className="panel">
          <h3>Reproducibility</h3>
          <dl className="kv small" style={{ marginTop: 12 }}>
            <dt>Protocol</dt>
            <dd>{ev?.protocol_ref}</dd>
            <dt>Protocol hash</dt>
            <dd className="mono">{shortHash(ev?.protocol_hash)}</dd>
            <dt>Evidence set</dt>
            <dd className="mono">{shortHash(ev?.evidence_set_hash)}</dd>
            <dt>Engine</dt>
            <dd>{ev?.engine_version}</dd>
            <dt>Evaluations</dt>
            <dd>{d.evaluations.length}</dd>
          </dl>
          <h3 style={{ marginTop: 18 }}>Receipts</h3>
          <ul className="timeline">
            {d.receipts.map((r) => (
              <li key={r.receipt_id}>
                <time>v{r.receipt_version}</time>
                <span>
                  <Link href={`/receipts/${r.receipt_id}`}>{r.receipt_id}</Link> {r.verdict} to {r.operational.action}
                  {r.supersedes ? <span className="muted"> supersedes {r.supersedes}</span> : null}
                </span>
              </li>
            ))}
            {!d.receipts.length && <li className="muted">Generated once a final action is applied.</li>}
          </ul>
        </div>
      </div>

      {/* 4 — Evidence & human review */}
      <div className="panel table-wrap" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Evidence</h2>
          <span className="small muted">Reviewers act on evidence, never on the outcome</span>
        </div>
        {note && <p className="notice small">{note}</p>}
        <table className="table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>State</th>
              <th>Occurred</th>
              <th>Interpretation</th>
              <th>Status</th>
              <th>Source event</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.evidence.map((e) => (
              <tr key={e.evidence_id}>
                <td>
                  <strong>{upper(protocol.labels, e.semantic_state)}</strong>
                  <div className="small mono muted">{e.evidence_id}</div>
                </td>
                <td>{hhmmss(e.occurred_at)}</td>
                <td className="small">{e.interpretation_mode}</td>
                <td className="small">Accepted</td>
                <td className="small mono">{e.source_refs[0]?.source_event_ref ?? e.source_refs[0]?.media_session_ref}</td>
                <td>
                  <button className="btn secondary" onClick={() => setDrawer({ state: e.semantic_state, occurred_at: e.occurred_at, evidence_id: e.evidence_id })}>
                    Provenance
                  </button>
                </td>
              </tr>
            ))}
            {d.candidates
              .filter((c) => c.status !== "ACCEPTED")
              .map((c) => (
                <tr key={c.candidate_id}>
                  <td>
                    <strong>{upper(protocol.labels, c.semantic_state)}?</strong>
                    <div className="small mono muted">{c.candidate_id}</div>
                  </td>
                  <td>{hhmmss(c.occurred_at)}</td>
                  <td className="small">
                    {c.interpretation_mode}
                    {c.assessment ? `, ${c.assessment} ${c.quality ?? ""}` : ""}
                  </td>
                  <td className="small">
                    {c.status}
                    {c.status_reason ? <div className="muted">{c.status_reason}</div> : null}
                  </td>
                  <td className="small mono">{c.source_refs[0]?.source_event_ref}</td>
                  <td>
                    {unresolved.includes(c) && (
                      <div className="btn-row">
                        <button className="btn" onClick={() => review(c.candidate_id, "CONFIRM")}>
                          Confirm evidence
                        </button>
                        <button className="btn secondary" onClick={() => review(c.candidate_id, "REJECT")}>
                          Reject evidence
                        </button>
                        <button className="btn secondary" onClick={() => review(c.candidate_id, "LEAVE_UNRESOLVED")}>
                          Leave unresolved
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* 5 — Audit trail */}
      <div className="panel" style={{ marginTop: 16 }}>
        <h2>Audit trail</h2>
        <ul className="timeline" style={{ marginTop: 10 }}>
          {d.events.map((e) => (
            <li key={e.event_id}>
              <time>{hhmmss(e.occurred_at)}</time>
              <span>
                <strong>{e.name}</strong>{" "}
                <span className="muted small">
                  {Object.entries(e.payload)
                    .filter(([, v]) => typeof v === "string" || typeof v === "boolean")
                    .slice(0, 4)
                    .map(([k, v]) => `${k} ${String(v)}`)
                    .join(", ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {drawer && <EvidenceDrawer detail={d} protocol={protocol} step={drawer} onClose={() => setDrawer(undefined)} />}
      <span className="sr-only">{STATUS_ACTION[(d.workflow?.status ?? "PENDING") as WorkflowStatus]}</span>
    </>
  );
}
