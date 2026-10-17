"use client";

import Link from "next/link";
import { useId } from "react";
import type { ChecklistRow, ChecklistView } from "@/lib/checklist";

const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : "—");

function Box({ status }: { status: ChecklistRow["status"] }) {
  if (status === "checked") {
    return (
      <span className="box checked" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`box ${status}`} aria-hidden="true">
      {status === "unresolved" ? "?" : ""}
    </span>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" fill="currentColor" />
      <path d={open ? "M8 10.5V7.5a4 4 0 0 1 7.6-1.7" : "M8 10.5V7.5a4 4 0 0 1 8 0v3"} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const ROW_STATUS: Record<ChecklistRow["status"], string> = { checked: "checked", unresolved: "could not be confirmed", open: "not observed yet" };

/**
 * The familiar artifact (Master Brief §2): a receiving checklist and its Release button.
 * The button mirrors the ReceivingWorkflow state the Operational Gate applied; pressing it
 * opens the reason (locked) or the release record (unlocked). It never changes state itself.
 */
export function DeliveryChecklist({
  title,
  view,
  expanded,
  onToggle,
  emphasize,
}: {
  title: string;
  view: ChecklistView;
  expanded: boolean;
  onToggle: () => void;
  /** Walkthrough focus: show the flagged / ordering rows highlighted. */
  emphasize?: boolean;
}) {
  const whyId = useId();
  const r = view.release;
  const showFlags = expanded || emphasize;
  return (
    <section className="checklist" data-tone={r.tone} aria-label={`${title} receiving checklist`}>
      <header className="checklist-head">
        <h2>{title}</h2>
        <span className="checklist-ref">
          <Link href={`/executions/${view.executionId}`}>{view.executionId}</Link>
        </span>
        <span className="checklist-source" title="Where these observations came from">
          <span className={`dot${view.sourceProfile ? "" : " off"}`} />
          {view.source}
        </span>
      </header>

      <ol className="checklist-rows">
        {view.rows.map((row) => (
          <li key={row.state} className={`checklist-row ${row.status}${row.flagged && showFlags ? " flagged" : ""}${row.signature && emphasize && !row.flagged ? " ordered" : ""}`}>
            <Box status={row.status} />
            <span className="row-label">{row.label}</span>
            <time className="row-time">{hhmm(row.at)}</time>
            <span className="sr-only">{ROW_STATUS[row.status]}</span>
          </li>
        ))}
      </ol>
      {view.also.length > 0 && (
        <p className="checklist-also">
          Also checked:{" "}
          {view.also.map((a, i) => (
            <span key={a.state}>
              {i > 0 ? ", " : ""}
              {a.label} {a.status === "checked" ? hhmm(a.at) : a.status === "unresolved" ? "unconfirmed" : "not yet"}
            </span>
          ))}
        </p>
      )}

      <button
        type="button"
        className={`release ${r.locked ? "locked" : "unlocked"}`}
        data-tone={r.tone}
        aria-expanded={expanded}
        aria-controls={whyId}
        aria-label={`Release delivery: ${r.locked ? "locked" : "unlocked"}. ${r.reason}. ${expanded ? "Hide" : "Show"} why.`}
        onClick={onToggle}
      >
        <span className="release-label">Release delivery</span>
        <span className="release-state">
          <LockIcon open={!r.locked} />
          {r.locked ? "Locked" : "Unlocked"}
        </span>
      </button>
      <p className="release-reason" data-tone={r.tone}>
        <strong>{r.reason}</strong>
        {r.detail ? <span className="release-detail">{r.detail}</span> : null}
      </p>

      <div id={whyId} className="why" hidden={!expanded}>
        {view.why ? (
          <>
            <h3 className={view.why.passed ? "why-pass" : "why-fail"}>{view.why.title}</h3>
            <dl className="why-grid">
              <dt>Expected</dt>
              <dd>{view.why.expected}</dd>
              <dt>Observed</dt>
              <dd>{view.why.observed}</dd>
            </dl>
          </>
        ) : (
          <p className="muted">No evaluation yet.</p>
        )}
        {view.chain && (
          <ol className="chain-list" aria-label="Why the workflow has this action">
            {view.chain.map((l, i) => (
              <li key={i} className={`chain-${l.kind.toLowerCase()}`}>
                {l.connector ? <span className="conn">{l.connector}</span> : null}
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="why-links">
          <Link href={`/executions/${view.executionId}`}>Open the full verification</Link>
          {view.receiptId ? <Link href={`/receipts/${view.receiptId}`}>Receipt {view.receiptId}</Link> : null}
        </p>
      </div>
    </section>
  );
}

export function ChecklistPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <section className="checklist" data-tone="none" aria-busy="true" aria-label={`${title} receiving checklist`}>
      <header className="checklist-head">
        <h2>{title}</h2>
      </header>
      <ol className="checklist-rows">
        {["Arrival", "Staging", "Storage"].map((l) => (
          <li key={l} className="checklist-row open">
            <span className="box open" aria-hidden="true" />
            <span className="row-label">{l}</span>
            <time className="row-time">—</time>
          </li>
        ))}
      </ol>
      <button type="button" className="release locked" data-tone="none" disabled>
        <span className="release-label">Release delivery</span>
        <span className="release-state">
          <LockIcon open={false} />
          Locked
        </span>
      </button>
      <p className="release-reason" data-tone="none">
        <strong>{note}</strong>
      </p>
    </section>
  );
}
