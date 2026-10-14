"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ActionBlock, VerdictMark } from "@/components/Marks";
import { hhmm, hhmmss, upper, usePoll } from "@/lib/client";
import { SOURCE_LABEL, type ProtocolView, type ReplayCheck, type SeqSealReceipt } from "@/lib/types";

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: r, error } = usePoll<SeqSealReceipt>(`/api/receipts/${id}`, 0);
  const { data: p } = usePoll<ProtocolView>("/api/protocol", 0);
  const [replay, setReplay] = useState<ReplayCheck>();
  const [replaying, setReplaying] = useState(false);

  async function runReplay() {
    setReplaying(true);
    const res = await fetch(`/api/receipts/${id}/replay`);
    setReplay((await res.json()) as ReplayCheck);
    setReplaying(false);
  }

  if (error) return <p className="notice error">Receipt {id} could not be loaded: {error}</p>;
  if (!r || !p) return <p className="muted">Loading receipt</p>;
  const failed = new Set(r.primary_failures);

  return (
    <>
      <p className="small">
        <Link href="/receipts">Receipts</Link> / {id}
      </p>
      <div className="page-head" style={{ marginTop: 10 }}>
        <div>
          <h1>SeqSeal Receipt {r.receipt_id}</h1>
          <p>
            Execution <Link href={`/executions/${r.execution_id}`}>{r.execution_id}</Link>, version {r.receipt_version}
            {r.supersedes ? `, supersedes ${r.supersedes}` : ""}. Generated {hhmmss(r.generated_at)} UTC.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={runReplay} disabled={replaying}>
            {replaying ? "Replaying" : "Replay verification"}
          </button>
          <a className="btn secondary" href={`/api/receipts/${id}`} download={`${id}.json`}>
            Download JSON
          </a>
        </div>
      </div>

      {replay && (
        <div className={`notice${replay.consistent ? "" : " error"}`} style={{ marginBottom: 16, borderColor: replay.consistent ? "var(--seal)" : undefined, background: replay.consistent ? "var(--seal-wash)" : undefined }}>
          {replay.consistent ? (
            <>
              <strong>Matches the original receipt.</strong> Same protocol hash, evidence set and engine gave verdict {replay.replayed.verdict}; the same policy hash gave action {replay.replayed.action}. Receipt hash is valid.
            </>
          ) : (
            <>
              <strong>Replay does not match this receipt.</strong> Failed checks:{" "}
              {(
                [
                  ["receipt hash", replay.receipt_hash_valid],
                  ["protocol hash", replay.protocol_hash_match],
                  ["policy hash", replay.policy_hash_match],
                  ["evidence set", replay.evidence_set_hash_match],
                  ["verdict", replay.verdict_match],
                  ["action", replay.action_match],
                ] as const
              )
                .filter(([, ok]) => !ok)
                .map(([k]) => k)
                .join(", ")}
              . Replayed {replay.replayed.verdict} to {replay.replayed.action}; original {replay.original.verdict} to {replay.original.action}.
            </>
          )}
        </div>
      )}

      <div className="split">
        <div className="panel">
          <ActionBlock action={r.operational.applied ? r.operational.action : null} pending="Action decided but not confirmed applied by the Operational Gate." />
          <div className="chain-step" style={{ marginTop: 14 }}>
            <VerdictMark verdict={r.verdict} />
            <span className="small muted">
              {r.operational.policy_mapping} under {r.action_policy.id} {r.action_policy.version}
              {r.operational.event_type ? `, emitted ${r.operational.event_type}` : ""}
            </span>
          </div>
          <p style={{ marginTop: 10 }}>{r.explanation}</p>

          <h3 style={{ marginTop: 22 }}>Observed execution</h3>
          <ul className="timeline" style={{ marginTop: 6 }}>
            {r.observed_sequence.map((s) => (
              <li key={s.evidence_id} style={failed.size && r.rule_results.some((x) => failed.has(x.rule_id) && x.evidence_refs.includes(s.evidence_id)) ? { background: "var(--hold-wash)" } : undefined}>
                <time>{hhmm(s.occurred_at)}</time>
                <span>
                  <strong>{upper(p.labels, s.state)}</strong> <span className="small muted">{s.evidence_id}</span>
                </span>
              </li>
            ))}
          </ul>

          <h3 style={{ marginTop: 22 }}>Rule results</h3>
          <table className="table" style={{ marginTop: 6 }}>
            <tbody>
              {r.rule_results.map((x) => (
                <tr key={x.rule_id} className={x.status === "FAIL" ? "row-fail" : undefined}>
                  <td style={{ width: 100 }}>
                    <strong>{x.rule_id}</strong>
                  </td>
                  <td style={{ width: 130 }}>{x.status.replace("_", " ")}</td>
                  <td className="small">{x.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="panel">
            <h3>Protocol and policy</h3>
            <dl className="kv small" style={{ marginTop: 10 }}>
              <dt>Protocol</dt>
              <dd>
                {r.protocol.id} {r.protocol.version}
              </dd>
              <dt>Protocol hash</dt>
              <dd className="mono">{r.protocol.hash}</dd>
              <dt>Action policy</dt>
              <dd>
                {r.action_policy.id} {r.action_policy.version}
              </dd>
              <dt>Policy hash</dt>
              <dd className="mono">{r.action_policy.hash}</dd>
              <dt>Engine</dt>
              <dd>{r.engine_version}</dd>
              <dt>Policy engine</dt>
              <dd>{r.policy_engine_version}</dd>
              <dt>Evidence set</dt>
              <dd className="mono">{r.evidence_set_hash}</dd>
              <dt>Receipt hash</dt>
              <dd className="mono">{r.receipt_hash}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>Evidence provenance</h3>
            <ul className="timeline" style={{ marginTop: 6 }}>
              {r.evidence.map((e) => (
                <li key={e.evidence_id}>
                  <time>{hhmm(e.occurred_at)}</time>
                  <span className="small">
                    <strong>{upper(p.labels, e.state)}</strong> from {SOURCE_LABEL[e.source_refs[0]?.source_profile ?? ""] ?? e.source_refs[0]?.source_profile}, event{" "}
                    <span className="mono">{e.source_refs[0]?.source_event_ref ?? e.source_refs[0]?.media_session_ref}</span> via {e.observation_refs[0]}, {e.interpretation_mode}
                    {e.review_id ? `, confirmed in ${e.review_id}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            {r.disclaimer}
          </p>
        </div>
      </div>
    </>
  );
}
