import { ACTION_MEANING, ACTION_TONE, ACTION_WORD, VERDICT_TONE, type Action, type Verdict } from "@/lib/types";

/** The seal: shield + check, from the SEQSEAL mark. */
export function SealGlyph({ size = 46, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg className="seal-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 41 12v12c0 10-7.5 17.5-17 20C14.5 41.5 7 34 7 24V12z" fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="m16 24 6 6 11-12" fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HoldGlyph({ size = 46 }: { size?: number }) {
  return (
    <svg className="seal-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="13" y="10" width="7" height="28" rx="1.5" fill="#3b2a00" />
      <rect x="28" y="10" width="7" height="28" rx="1.5" fill="#3b2a00" />
    </svg>
  );
}

const GLYPH: Record<string, string> = { seal: "✓", hold: "✕", wait: "○", review: "?" };

export function VerdictMark({ verdict, size = "md" }: { verdict?: Verdict | string; size?: "sm" | "md" }) {
  if (!verdict) return <span className="muted">No verdict yet</span>;
  const tone = VERDICT_TONE[verdict as Verdict] ?? "wait";
  return (
    <span className={`verdict tone-${tone}`} style={size === "sm" ? { fontSize: "0.85rem" } : undefined}>
      <span className="glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      {verdict}
    </span>
  );
}

export function StatusPill({ action, status }: { action?: Action | null; status?: string }) {
  const tone = action ? ACTION_TONE[action] : "none";
  return <span className={`status-pill tone-${tone}`}>{status ? status.replace("_", " ") : action ? ACTION_WORD[action] : "PENDING"}</span>;
}

/** Operational action, shown larger than the verdict: it is the business consequence (Doc 05 §7). */
export function ActionBlock({ action, pending }: { action?: Action | null; pending?: string }) {
  if (!action) {
    return (
      <div className="action-block tone-none" role="status">
        <div>
          <div className="word" style={{ fontSize: "1.6rem" }}>
            PENDING
          </div>
          <div className="meaning">{pending ?? "Waiting for evidence from Ring."}</div>
        </div>
      </div>
    );
  }
  const tone = ACTION_TONE[action];
  return (
    <div className={`action-block tone-${tone}`} role="status" aria-label={`Operational action ${action}`}>
      {tone === "seal" && <SealGlyph />}
      {tone === "hold" && <HoldGlyph />}
      <div>
        <div className="word">{ACTION_WORD[action]}</div>
        <div className="meaning">{ACTION_MEANING[action]}</div>
      </div>
    </div>
  );
}
