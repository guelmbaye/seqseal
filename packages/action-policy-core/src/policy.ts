import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  ACTIONS,
  ActionPolicyDocument,
  POLICY_ENGINE_VERSION,
  VERDICTS,
  hashCanonical,
  type Action,
  type OperationalDecision,
  type Verdict,
  type WorkflowEvaluation,
} from "@seqseal/contracts";

/**
 * Action Policy Engine (Doc 03 §39–58):
 *
 *   A = g(V, Π)
 *
 * Consumes a final workflow verdict and an explicit, versioned policy. Never
 * re-evaluates evidence, never calls a model, never mutates downstream state.
 */
export interface ActionPolicy {
  id: string;
  name: string;
  version: string;
  profile: "safe-mvp";
  description?: string;
  mappings: Record<Verdict, Action>;
  /** Actions that may be applied before an execution is finalized (never RELEASE). */
  provisionalActions: Action[];
  hash: string;
  /** `id@version` */
  ref: string;
}

export class PolicyInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`POLICY_INVALID: ${errors.join("; ")}`);
    this.name = "PolicyInvalidError";
  }
}

/** Thrown when any path would RELEASE a non-SEALED verdict. Must never happen. */
export class ReleaseInvariantViolation extends Error {
  constructor(verdict: string) {
    super(`RELEASE ⇒ SEALED invariant violated: attempted RELEASE for verdict ${verdict}`);
    this.name = "ReleaseInvariantViolation";
  }
}

export interface PolicyValidation {
  valid: boolean;
  errors: string[];
  policy?: ActionPolicy;
}

/**
 * Validate an ActionPolicy before activation (Doc 03 §89–90). The MVP safe profile
 * rejects any mapping that could RELEASE a non-SEALED workflow, even if representable.
 */
export function validateActionPolicy(input: unknown): PolicyValidation {
  const parsed = ActionPolicyDocument.safeParse(input);
  if (!parsed.success) {
    return { valid: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const doc = parsed.data;
  const errors: string[] = [];
  const verdicts = new Set<string>(VERDICTS);
  const actions = new Set<string>(ACTIONS);

  for (const key of Object.keys(doc.mappings)) {
    if (!verdicts.has(key)) errors.push(`mappings.${key}: unknown verdict`);
  }
  for (const v of VERDICTS) {
    const a = doc.mappings[v];
    if (a === undefined) errors.push(`mappings.${v}: every verdict must have a mapping`);
    else if (!actions.has(a)) errors.push(`mappings.${v}: unknown action "${a}"`);
    else if (a === "RELEASE" && v !== "SEALED") errors.push(`mappings.${v}: safe profile forbids ${v} → RELEASE (only SEALED may RELEASE)`);
  }
  const seenProvisional = new Set<string>();
  for (const a of doc.provisional_actions) {
    if (!actions.has(a)) errors.push(`provisional_actions: unknown action "${a}"`);
    if (a === "RELEASE") errors.push("provisional_actions: RELEASE can never be applied provisionally");
    if (seenProvisional.has(a)) errors.push(`provisional_actions: duplicate "${a}"`);
    seenProvisional.add(a);
  }
  if (errors.length) return { valid: false, errors };

  const mappings = Object.fromEntries(VERDICTS.map((v) => [v, doc.mappings[v] as Action])) as Record<Verdict, Action>;
  const provisionalActions = [...doc.provisional_actions].sort() as Action[];
  const hash = hashCanonical({
    id: doc.id,
    name: doc.name,
    version: doc.version,
    profile: doc.profile,
    mappings,
    provisional_actions: provisionalActions,
  });
  return {
    valid: true,
    errors: [],
    policy: {
      id: doc.id,
      name: doc.name,
      version: doc.version,
      profile: doc.profile,
      ...(doc.description ? { description: doc.description } : {}),
      mappings,
      provisionalActions,
      hash,
      ref: `${doc.id}@${doc.version}`,
    },
  };
}

export function loadActionPolicy(source: string): ActionPolicy {
  const r = validateActionPolicy(parseYaml(source, { schema: "core", uniqueKeys: true }));
  if (!r.valid || !r.policy) throw new PolicyInvalidError(r.errors);
  return r.policy;
}

export function loadActionPolicyFile(path: string): ActionPolicy {
  return loadActionPolicy(readFileSync(path, "utf8"));
}

export type PolicyOutcome =
  | { kind: "DECISION"; decision: OperationalDecision }
  | { kind: "DEFERRED"; verdict: Verdict; mapped_action: Action; reason: string };

export interface DecideInput {
  evaluation: WorkflowEvaluation;
  policy: ActionPolicy;
  /** Wall-clock time of the decision (supplied by the caller; the engine has no clock). */
  now: string;
  amends?: string;
}

/** Map one workflow evaluation to an operational decision under a policy. Deterministic. */
export function decide({ evaluation, policy, now, amends }: DecideInput): PolicyOutcome {
  const verdict = evaluation.verdict;
  const action = policy.mappings[verdict];
  const final = evaluation.mode === "FINAL";

  // Defensive invariant, independent of policy validation (Doc 06 §54).
  if (action === "RELEASE" && verdict !== "SEALED") throw new ReleaseInvariantViolation(verdict);

  if (!final && !policy.provisionalActions.includes(action)) {
    return {
      kind: "DEFERRED",
      verdict,
      mapped_action: action,
      reason: `${verdict} → ${action} is not applied provisionally; waiting for finalization.`,
    };
  }

  const reasonRefs = verdict === "DEVIATED"
    ? evaluation.primary_failures
    : verdict === "UNCERTAIN"
      ? evaluation.rule_results.filter((r) => r.status === "NOT_EVALUABLE" && r.reason && r.reason !== "MISSING_EVIDENCE").map((r) => r.rule_id)
      : verdict === "INCOMPLETE"
        ? evaluation.rule_results.filter((r) => r.reason === "MISSING_EVIDENCE" && r.kind === "REQUIRED").map((r) => r.rule_id)
        : evaluation.rule_results.filter((r) => r.status === "PASS").map((r) => r.rule_id);
  const evidenceRefs = [...new Set(evaluation.rule_results.filter((r) => reasonRefs.includes(r.rule_id)).flatMap((r) => r.evidence_refs))].sort();

  const decision: OperationalDecision = {
    decision_id: evaluation.evaluation_id.startsWith("EVAL-") ? evaluation.evaluation_id.replace(/^EVAL-/, "DEC-") : `DEC-${evaluation.evaluation_id}`,
    idempotency_key: hashCanonical([evaluation.execution_id, evaluation.evaluation_id, policy.hash]),
    execution_id: evaluation.execution_id,
    evaluation_id: evaluation.evaluation_id,
    evaluation_seq: evaluation.seq,
    verdict,
    action,
    final,
    action_policy_id: policy.id,
    action_policy_version: policy.version,
    action_policy_hash: policy.hash,
    policy_engine_version: POLICY_ENGINE_VERSION,
    reason_code: `POLICY_${verdict}_TO_${action}`,
    reason: `Action policy ${policy.ref} maps ${verdict} → ${action}. ${evaluation.explanation}`,
    reason_refs: reasonRefs,
    evidence_refs: evidenceRefs,
    triggered_at: now,
    ...(amends ? { amends } : {}),
    correlation_id: evaluation.correlation_id,
  };
  if (decision.action === "RELEASE" && decision.verdict !== "SEALED") throw new ReleaseInvariantViolation(decision.verdict);
  return { kind: "DECISION", decision };
}
