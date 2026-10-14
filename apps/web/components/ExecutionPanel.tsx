"use client";

import Link from "next/link";
import { hhmmss } from "@/lib/client";
import { STATUS_ACTION, SOURCE_LABEL, type Action, type ExecutionDetail, type ProtocolView, type Verdict, type WorkflowStatus } from "@/lib/types";
import { ActionBlock, StatusPill, VerdictMark } from "./Marks";
import { SequenceLanes, type LaneStep } from "./SequenceLanes";

export function laneData(d: ExecutionDetail) {
  const ev = d.evaluation;
  const accepted: LaneStep[] = (ev?.observed_sequence ?? []).map((s) => ({ state: s.state, occurred_at: s.occurred_at, evidence_id: s.evidence_id }));
  const unresolved: LaneStep[] = d.candidates
    .filter((c) => c.status === "UNCERTAIN" || c.status === "MEDIA_PENDING")
    .filter((c) => !accepted.some((a) => a.state === c.semantic_state))
    .map((c) => ({ state: c.semantic_state, occurred_at: c.occurred_at, evidence_id: c.candidate_id, unresolved: true }));
  const observed = [...accepted, ...unresolved].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const primary = ev?.primary_failures[0];
  const violated = primary ? (ev?.rule_results.find((r) => r.rule_id === primary)?.states ?? []) : [];
  return { observed, violated, missing: ev?.missing_states ?? [], primary };
}

export function workflowAction(d: ExecutionDetail): Action | null {
  return d.workflow ? STATUS_ACTION[d.workflow.status as WorkflowStatus] : null;
}

const SIGNATURE_RULE = "ORDER-02";

export function ExecutionPanel({
  detail,
  protocol,
  title,
  onSelectStep,
  live,
}: {
  detail: ExecutionDetail;
  protocol: ProtocolView;
  title?: string;
  onSelectStep?: (step: LaneStep) => void;
  live?: boolean;
}) {
  const ev = detail.evaluation;
  const { observed, violated, missing, primary } = laneData(detail);
  const action = workflowAction(detail);
  const decision = detail.decisions.at(-1);
  const lastEvent = detail.workflow?.history.filter((h) => h.event_type).at(-1);
  const signature = ev?.rule_results.find((r) => r.rule_id === (primary ?? SIGNATURE_RULE));
  const profile = detail.execution.source_profiles[0];

  return (
    <section className="exec-panel" aria-labelledby={`h-${detail.execution.execution_id}`}>
      <div className="exec-panel-head">
        <div>
          <h2 id={`h-${detail.execution.execution_id}`} style={{ fontSize: "1.25rem" }}>
            {title ?? detail.execution.replay?.label ?? detail.execution.execution_id}
          </h2>
          <p className="small muted">
            <Link href={`/executions/${detail.execution.execution_id}`}>{detail.execution.execution_id}</Link>
            {", "}
            {detail.execution.status === "FINALIZED" ? "finalized" : live ? "receiving Ring evidence" : "active"}
          </p>
        </div>
        {profile && (
          <span className="source-chip" title="Source profile of the evidence">
            <span className="dot" />
            Source <strong>{SOURCE_LABEL[profile] ?? profile}</strong>
          </span>
        )}
      </div>

      <SequenceLanes expected={ev?.expected_sequence ?? protocol.expected_sequence} labels={protocol.labels} observed={observed} violated={violated} missing={detail.execution.status === "FINALIZED" ? missing : []} onSelect={onSelectStep} animate={live} />

      {signature && (
        <div className={`rule-callout${signature.status === "FAIL" ? "" : " ok"}`}>
          <strong>
            {signature.rule_id} {signature.status === "FAIL" ? "failed" : signature.status === "PASS" ? "passed" : "not evaluable yet"}
          </strong>
          <span className="small" style={{ display: "block", marginTop: 2 }}>
            {signature.explanation}
          </span>
        </div>
      )}

      <div className="chain" aria-label="Verdict to operational action">
        <div className="chain-step">
          <VerdictMark verdict={ev?.verdict as Verdict | undefined} />
          {ev && ev.mode === "PROVISIONAL" && <span className="small muted">provisional</span>}
        </div>
        <div className="chain-arrow" aria-hidden="true">
          ↓
        </div>
        <div className="chain-step small muted">
          {decision ? (
            <>
              Action policy {decision.action_policy_id} {decision.action_policy_version} maps {decision.verdict} to {decision.action}
            </>
          ) : ev ? (
            <>Release waits for finalization; the policy never releases provisionally.</>
          ) : (
            <>Action policy not yet applied</>
          )}
        </div>
        <div className="chain-arrow" aria-hidden="true">
          ↓
        </div>
        <ActionBlock action={action} pending={ev?.explanation} />
      </div>

      <div className="workflow-line">
        <span>Receiving workflow</span>
        <StatusPill action={null} status="PENDING" />
        <span aria-hidden="true">to</span>
        <StatusPill action={action} status={detail.workflow?.status} />
        {lastEvent && (
          <span>
            via <strong>{lastEvent.event_type}</strong> at {hhmmss(lastEvent.at)}
          </span>
        )}
        {detail.receipts.length > 0 && (
          <Link href={`/receipts/${detail.receipts.at(-1)!.receipt_id}`} style={{ marginLeft: "auto" }}>
            Receipt {detail.receipts.at(-1)!.receipt_id}
          </Link>
        )}
      </div>
    </section>
  );
}
