"use client";

import { useState } from "react";
import { upper, usePoll } from "@/lib/client";
import type { PolicyView, ProtocolView } from "@/lib/types";

const KIND_TITLE: Record<string, string> = {
  REQUIRED: "Required states",
  PRECEDENCE: "Ordering",
  WITHIN: "Timing",
  FORBIDDEN_TRANSITION: "Forbidden conditions",
  FORBIDDEN_STATE: "Forbidden conditions",
};

export default function ProtocolPage() {
  const { data: p } = usePoll<ProtocolView>("/api/protocol", 0);
  const { data: policy } = usePoll<PolicyView>("/api/policy", 0);
  const [source, setSource] = useState<string>();

  async function showSource() {
    const r = await fetch("/api/protocol/source");
    const body = (await r.json()) as { source?: string };
    setSource(body.source ?? "Source unavailable.");
  }

  if (!p) return <p className="muted">Loading protocol</p>;
  const groups = [...new Set(p.rules.map((r) => KIND_TITLE[r.kind] ?? r.kind))];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <p>
            What should happen physically, declared with PWPS {p.pwps} and verified against Ring evidence. The protocol says nothing about cameras, cloud services or business actions.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn secondary" onClick={showSource}>
            View protocol source
          </button>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="panel-head">
            <h2>{p.ref}</h2>
            <span className="small mono muted" title={p.hash}>
              {p.hash}
            </span>
          </div>
          <div className="btn-row" aria-label="Expected sequence">
            {p.expected_sequence.map((s, i) => (
              <span key={s} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {i > 0 && <span className="muted">›</span>}
                <span className="token">{upper(p.labels, s)}</span>
              </span>
            ))}
          </div>

          {groups.map((g) => (
            <div key={g} style={{ marginTop: 22 }}>
              <h3>{g}</h3>
              <table className="table" style={{ marginTop: 6 }}>
                <tbody>
                  {p.rules
                    .filter((r) => (KIND_TITLE[r.kind] ?? r.kind) === g)
                    .map((r) => (
                      <tr key={r.id}>
                        <td style={{ width: 110 }}>
                          <strong>{r.id}</strong>
                        </td>
                        <td>{r.text}</td>
                        <td className="small muted" style={{ width: 110 }}>
                          {r.severity === "MANDATORY" ? "mandatory" : "advisory"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <div>
          <div className="panel">
            <h3>States and zones</h3>
            <table className="table" style={{ marginTop: 6 }}>
              <tbody>
                {p.states.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{upper(p.labels, s.id)}</strong>
                    </td>
                    <td className="small">{p.zones.find((z) => z.id === s.zone)?.name ?? s.zone}</td>
                    <td className="small muted">{[s.required ? "required" : "optional", s.terminal ? "terminal" : ""].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {policy && (
            <div className="panel">
              <div className="panel-head">
                <h3>Action policy</h3>
                <span className="small muted">
                  {policy.ref}, separate from the protocol
                </span>
              </div>
              <p className="small muted">Verification and action are separate by design. The protocol engine decides what the evidence proves; this versioned policy decides what happens next.</p>
              <table className="table" style={{ marginTop: 10 }}>
                <tbody>
                  {Object.entries(policy.mappings).map(([v, a]) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td>
                        <strong>{a}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ marginTop: 10 }}>
                Safe profile: only SEALED may release, and release is never applied provisionally. Applied early when proven: {policy.provisional_actions.join(", ")}.
              </p>
            </div>
          )}
        </div>
      </div>

      {source && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h3>protocols/inbound-delivery.yaml</h3>
            <button className="btn secondary" onClick={() => setSource(undefined)}>
              Hide source
            </button>
          </div>
          <pre className="source">{source}</pre>
        </div>
      )}
    </>
  );
}
