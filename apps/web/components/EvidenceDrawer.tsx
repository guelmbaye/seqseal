"use client";

import { useEffect } from "react";
import { hhmmss, upper } from "@/lib/client";
import { SOURCE_LABEL, type ExecutionDetail, type ProtocolView } from "@/lib/types";
import type { LaneStep } from "./SequenceLanes";

/**
 * Evidence drawer: one click from an observed state down to the Ring source.
 * Distinguishes what Ring supplied from what SEQSEAL inferred (Doc 04 §90).
 */
export function EvidenceDrawer({ detail, protocol, step, onClose }: { detail: ExecutionDetail; protocol: ProtocolView; step: LaneStep; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const evidence = detail.evidence.find((e) => e.evidence_id === step.evidence_id);
  const candidate = detail.candidates.find((c) => c.candidate_id === (evidence?.candidate_id ?? step.evidence_id));
  const obsId = (evidence ?? candidate)?.observation_refs[0];
  const obs = detail.observations.find((o) => o.observation_id === obsId);
  const src = (evidence ?? candidate)?.source_refs[0];
  const rules = detail.evaluation?.rule_results.filter((r) => r.evidence_refs.includes(step.evidence_id ?? "")) ?? [];
  const failed = rules.find((r) => r.status === "FAIL");
  const action = detail.workflow?.status;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${upper(protocol.labels, step.state)}`}>
        <div className="panel-head">
          <h2>{upper(protocol.labels, step.state)} evidence</h2>
          <button className="btn secondary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>

        <div className="breadcrumb" aria-label="Provenance chain">
          <span className="node">{src ? (SOURCE_LABEL[src.source_profile] ?? src.source_profile) : "Source"}</span>
          <span className="sep">to</span>
          <span className="node">{obsId ?? "observation"}</span>
          <span className="sep">to</span>
          <span className="node">{step.evidence_id}</span>
          {rules[0] && (
            <>
              <span className="sep">to</span>
              <span className="node">{(failed ?? rules[0]).rule_id}</span>
            </>
          )}
          {detail.evaluation && (
            <>
              <span className="sep">to</span>
              <span className="node">{detail.evaluation.verdict}</span>
            </>
          )}
          {action && (
            <>
              <span className="sep">to</span>
              <span className="node">{action}</span>
            </>
          )}
        </div>

        <h3 style={{ marginTop: 22 }}>What the source supplied</h3>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Source profile</dt>
          <dd>{src ? (SOURCE_LABEL[src.source_profile] ?? src.source_profile) : "—"}</dd>
          <dt>Ring event</dt>
          <dd className="mono">{src?.source_event_ref ?? "—"}</dd>
          <dt>Request</dt>
          <dd className="mono">{src?.request_ref ?? "—"}</dd>
          <dt>Device</dt>
          <dd className="mono">{src?.device_ref ?? "—"}</dd>
          {src?.component_refs?.length ? (
            <>
              <dt>Component</dt>
              <dd className="mono">{src.component_refs.join(", ")}</dd>
            </>
          ) : null}
          {src?.simulation_source && (
            <>
              <dt>Playground source</dt>
              <dd>{src.simulation_source}</dd>
            </>
          )}
          <dt>Event type</dt>
          <dd>
            {obs?.event_type}
            {obs?.event_subtype ? `, subtype ${obs.event_subtype}` : ""}
          </dd>
          <dt>Occurred</dt>
          <dd>
            {hhmmss(obs?.occurred_at ?? step.occurred_at)} UTC
            {obs?.time_precision_ms ? <span className="muted"> (±{obs.time_precision_ms / 1000} s)</span> : null}
          </dd>
          <dt>Received</dt>
          <dd>{hhmmss(obs?.received_at)} UTC</dd>
        </dl>

        <h3 style={{ marginTop: 22 }}>What SEQSEAL derived</h3>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>Logical zone</dt>
          <dd>
            {obs?.logical_zone ?? candidate?.logical_zone ?? "—"}
            {obs?.binding_id ? <span className="muted"> via {obs.binding_id}</span> : null}
          </dd>
          <dt>Interpretation</dt>
          <dd>
            {(evidence ?? candidate)?.interpretation_mode}
            {candidate?.mapping_id ? <span className="muted"> ({candidate.mapping_id})</span> : null}
          </dd>
          {candidate?.model_id && (
            <>
              <dt>Model</dt>
              <dd>{candidate.model_id}</dd>
            </>
          )}
          {candidate?.assessment && (
            <>
              <dt>AI assessment</dt>
              <dd>
                {candidate.assessment}, quality {candidate.quality}, {candidate.reason_code}
              </dd>
            </>
          )}
          <dt>Evidence status</dt>
          <dd>{evidence ? `ACCEPTED (${evidence.acceptance_rule})` : `${candidate?.status ?? "—"}${candidate?.status_reason ? ` (${candidate.status_reason})` : ""}`}</dd>
        </dl>
        {candidate?.interpretation_mode === "AI_ASSISTED" && (
          <p className="notice small" style={{ marginTop: 14 }}>
            AI proposed this interpretation. It cannot seal or release the workflow: the verdict comes from the deterministic engine and the action from the versioned policy.
          </p>
        )}

        {rules.length > 0 && (
          <>
            <h3 style={{ marginTop: 22 }}>Rules using this evidence</h3>
            <ul className="timeline" style={{ marginTop: 8 }}>
              {rules.map((r) => (
                <li key={r.rule_id}>
                  <strong>{r.rule_id}</strong>
                  <span>
                    {r.status}: {r.explanation}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </>
  );
}
