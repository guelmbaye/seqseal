"use client";

import { hhmm, upper } from "@/lib/client";

export interface LaneStep {
  state: string;
  occurred_at: string;
  evidence_id?: string;
  unresolved?: boolean;
}

interface Props {
  expected: string[];
  labels: Record<string, string>;
  observed: LaneStep[];
  /** States involved in a failed (authoritative) rule — drawn as crossing amber connectors. */
  violated?: string[];
  missing?: string[];
  onSelect?: (step: LaneStep) => void;
  animate?: boolean;
  caption?: string;
}

/**
 * Expected vs Observed, drawn as two aligned lanes with connectors from each expected
 * slot to where that state was actually observed. Straight connectors = order kept.
 * Crossing amber connectors = the sequence violation, visible before reading any text.
 */
export function SequenceLanes({ expected, labels, observed, violated = [], missing = [], onSelect, animate, caption }: Props) {
  const n = Math.max(expected.length, observed.length, 1);
  const cols = `repeat(${n}, minmax(0, 1fr))`;
  const v = new Set(violated);
  const W = n * 100;
  const cx = (i: number) => i * 100 + 50;

  const connectors = observed
    .map((step, j) => ({ step, i: expected.indexOf(step.state), j }))
    .filter((c) => c.i >= 0);

  return (
    <figure className="lanes" style={{ margin: 0 }} aria-label={caption ?? "Expected versus observed sequence"}>
      <p className="lane-label">Expected by protocol</p>
      <div className="lane-row" style={{ gridTemplateColumns: cols }}>
        {expected.map((s) => (
          <span key={s} className={`token expected${v.has(s) ? " violated" : ""}${missing.includes(s) ? " missing" : ""}`} title={upper(labels, s)}>
            {upper(labels, s)}
          </span>
        ))}
      </div>

      <svg className="lane-connectors" viewBox={`0 0 ${W} 46`} preserveAspectRatio="none" aria-hidden="true">
        {connectors.map(({ step, i, j }) => {
          const bad = v.has(step.state);
          return (
            <line
              key={`${step.state}-${j}`}
              x1={cx(i)}
              y1={2}
              x2={cx(j)}
              y2={44}
              stroke={step.unresolved ? "#6b45d9" : bad ? "#f0a500" : "#1463f3"}
              strokeWidth={bad ? 4 : 2}
              strokeDasharray={step.unresolved ? "5 4" : undefined}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <div className="lane-row" style={{ gridTemplateColumns: cols }}>
        {observed.map((step, j) => {
          const cls = step.unresolved ? "unresolved" : v.has(step.state) ? "violated" : "passed";
          const content = (
            <>
              <span className={`token ${cls}${animate ? " landed" : ""}`} style={{ width: "100%" }}>
                {upper(labels, step.state)}
                {step.unresolved ? "?" : ""}
              </span>
              <span className="lane-time">{hhmm(step.occurred_at)}</span>
            </>
          );
          return onSelect ? (
            <button
              key={`${step.state}-${j}-${step.occurred_at}`}
              type="button"
              onClick={() => onSelect(step)}
              style={{ all: "unset", cursor: "pointer", display: "block", minWidth: 0 }}
              aria-label={`Open evidence for ${upper(labels, step.state)} at ${hhmm(step.occurred_at)}`}
            >
              {content}
            </button>
          ) : (
            <div key={`${step.state}-${j}-${step.occurred_at}`} style={{ minWidth: 0 }}>
              {content}
            </div>
          );
        })}
      </div>
      <p className="lane-label" style={{ marginTop: 4 }}>
        Observed from Ring evidence
      </p>
    </figure>
  );
}
