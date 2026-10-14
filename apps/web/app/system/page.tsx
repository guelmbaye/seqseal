"use client";

import { hhmmss, shortHash, usePoll } from "@/lib/client";
import { SOURCE_LABEL, type NormalizedObservation, type SystemStatus } from "@/lib/types";

export default function SystemPage() {
  const { data: s } = usePoll<SystemStatus & { mode?: string }>("/api/status", 3000);
  const { data: obs } = usePoll<NormalizedObservation[]>("/api/observations?limit=25", 3000);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>System</h1>
          <p>Which source, protocol, policy and engines produced the decisions on screen.</p>
        </div>
      </div>
      {s && (
        <div className="grid-2">
          <div className="panel">
            <h3>Ring</h3>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Last source</dt>
              <dd>{s.last_observation ? (SOURCE_LABEL[s.last_observation.source_profile] ?? s.last_observation.source_profile) : "No observation yet"}</dd>
              <dt>Last observation</dt>
              <dd>{s.last_observation ? `${s.last_observation.event_type}, received ${hhmmss(s.last_observation.received_at)} UTC` : "—"}</dd>
              <dt>Profiles seen</dt>
              <dd>{s.profiles_seen.map((p) => SOURCE_LABEL[p] ?? p).join(", ") || "—"}</dd>
              <dt>Lane</dt>
              <dd>{s.sources.lane}</dd>
              <dt>Bindings</dt>
              <dd>
                {s.sources.bindings} bindings, {s.sources.mappings} mappings
              </dd>
              <dt>Source config</dt>
              <dd className="mono">{shortHash(s.sources.hash)}</dd>
            </dl>
          </div>
          <div className="panel">
            <h3>Verification and action</h3>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Protocol</dt>
              <dd>{s.protocol.ref}</dd>
              <dt>Protocol hash</dt>
              <dd className="mono">{shortHash(s.protocol.hash)}</dd>
              <dt>Sequence engine</dt>
              <dd>{s.engine_version}</dd>
              <dt>Action policy</dt>
              <dd>{s.policy.ref}</dd>
              <dt>Policy engine</dt>
              <dd>{s.policy_engine_version}</dd>
              <dt>Evidence interpreter</dt>
              <dd>{s.interpreter}</dd>
              <dt>Backend</dt>
              <dd>{s.backend}</dd>
              <dt>Counts</dt>
              <dd>
                {s.counts.executions} executions, {s.counts.receipts} receipts, {s.counts.observations} observations
              </dd>
            </dl>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <p className="trust">AI can propose evidence. It cannot seal or release the workflow.</p>
        <p className="small muted" style={{ marginTop: 6 }}>
          On AWS the Sequence Evaluator, Policy Evaluator, Operational Gate and Receipt Generator roles carry an explicit deny on Bedrock; only the media interpreter may call a model, and it can only write evidence candidates.
        </p>
      </div>

      <div className="panel table-wrap" style={{ marginTop: 16 }}>
        <h3>Recent observations</h3>
        <table className="table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Received</th>
              <th>Occurred</th>
              <th>Source</th>
              <th>Event</th>
              <th>Zone</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {(obs ?? []).map((o) => (
              <tr key={o.observation_id}>
                <td>{hhmmss(o.received_at)}</td>
                <td>{hhmmss(o.occurred_at)}</td>
                <td className="small">{SOURCE_LABEL[o.source_profile] ?? o.source_profile}</td>
                <td className="small">
                  {o.event_type}
                  {o.event_subtype ? `, ${o.event_subtype}` : ""}
                  {o.simulation_source ? `, ${o.simulation_source}` : ""}
                </td>
                <td className="small">{o.logical_zone ?? <span className="muted">unbound</span>}</td>
                <td className="small muted">{typeof o.attributes.resolution === "string" ? o.attributes.resolution : "Mapped to evidence"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
