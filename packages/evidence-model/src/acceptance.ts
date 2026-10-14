import type { CandidateStatus, EvidenceCandidate } from "@seqseal/contracts";
import type { AcceptancePolicy } from "./config";

export interface AcceptanceOutcome {
  status: Extract<CandidateStatus, "ACCEPTED" | "UNCERTAIN" | "REJECTED">;
  rule_id: string;
}

/**
 * Evidence acceptance is explicit product policy (Doc 07 §16). First matching rule wins;
 * unmatched candidates fall back to the policy default (UNCERTAIN or REJECT) — never ACCEPT.
 */
export function applyAcceptance(candidate: EvidenceCandidate, policy: AcceptancePolicy): AcceptanceOutcome {
  for (const rule of policy.rules) {
    if (rule.when.mode !== candidate.interpretation_mode) continue;
    if (rule.when.assessment && (!candidate.assessment || !rule.when.assessment.includes(candidate.assessment))) continue;
    if (rule.when.quality && (!candidate.quality || !rule.when.quality.includes(candidate.quality))) continue;
    return {
      status: rule.outcome === "ACCEPT" ? "ACCEPTED" : rule.outcome === "REJECT" ? "REJECTED" : "UNCERTAIN",
      rule_id: `${policy.id}@${policy.version}#${rule.id}`,
    };
  }
  return { status: policy.default === "REJECT" ? "REJECTED" : "UNCERTAIN", rule_id: `${policy.id}@${policy.version}#default` };
}
