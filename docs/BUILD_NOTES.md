# Build notes

Meaningful decisions made while building SEQSEAL, with the reason and where the decision is enforced. Routine implementation details are not recorded here.

## BN-001 — One pipeline core, two runtimes

**Decision.** The pipeline (`packages/pipeline`) depends only on two interfaces: `DocDatabase` and an event bus. `LocalRuntime` runs it in-process with in-memory implementations. `packages/aws` provides DynamoDB, EventBridge, S3, Secrets Manager and Bedrock implementations for 13 Lambda functions.

**Why.** Judges must be able to run the real decision path with `pnpm install && pnpm demo`, without an AWS account. A separate "demo mode" implementation would prove nothing about the deployed system. Fixture replay, the benchmark and the web demo all go through `ingestWebhook` / `ingestPlaygroundCapture`, exactly like Ring traffic.

## BN-002 — TEMP-01 tuned from PT5M to PT7M

**Decision.** In `protocols/inbound-delivery.yaml`, TEMP-01 is now *STAGING within 7 minutes after ARRIVAL* (was 5).

**Why.** In the canonical Execution B, STAGING occurs at 14:06, six minutes after ARRIVAL at 14:00. With a 5-minute window, B would fail TEMP-01 as well as ORDER-02. Then A and B would differ in two rules, and the Winning Moment ("same events, only the order changes") would no longer be a clean single-variable demonstration. 7 minutes keeps TEMP-01 passing for both A and B.

**Coverage.** Benchmark B03 still proves TEMP-01 enforcement (STAGING 8 minutes after ARRIVAL → DEVIATED → HOLD). The thresholds are demo values, not logistics standards; the protocol header says so.

## BN-003 — The Developer Playground is not treated as a webhook source

**Decision.** Playground captures become `live_view_simulation` observations with a `simulation_source` (PACKAGE / VEHICLE / MOTION) and an operator-declared `session_zone`. A capture without a successful (2xx) Ring API call in `api_evidence` is refused.

**Why.** The Playground simulates live-view sources; it does not emit production notifications. Converting a Playground session into a fabricated `motion_detected.package_delivery` webhook would misrepresent the source. The evidence drawer discloses the declared zone, and the profile label is always shown.

## BN-004 — Physical time with explicit precision

**Decision.** Evidence is ordered by `occurred_at` (the Ring `attributes.timestamp`), not by delivery time. When Ring supplies no physical timestamp, the envelope send time is used with ±30 s precision. Two events whose uncertainty windows overlap cannot be ordered, and the dependent ordering rule is NOT_EVALUABLE.

**Why.** Webhooks can be delayed or reordered (B07, B18). A send-time fallback that silently claimed 1 s precision could turn a delivery artifact into a false DEVIATED (B25).

## BN-005 — A contested failure is UNCERTAIN, not DEVIATED

**Decision.** A FAIL that depends on ambiguous evidence, a coverage gap or a correlation ambiguity is marked contested and yields UNCERTAIN → REVIEW.

**Why.** HOLD is an operational accusation that a violation was proven. An offline staging camera (B08), indistinguishable timestamps (B09) or a second ARRIVAL in the lane (B20) do not prove anything; a person should look.

## BN-006 — First accepted occurrence governs precedence

**Decision.** When a state is observed several times, ordering rules use its first accepted occurrence.

**Why.** Repeated legitimate motion in the staging area (B28) must not turn a correct sequence into a violation, and the rule must be the same on every replay.

## BN-007 — Errors are never verdicts; receipts never overstate

**Decision.** If the engine throws, the execution records `system_error: ENGINE_ERROR` and no verdict, decision or receipt is produced (B16). If the Operational Gate fails after a valid RELEASE decision, the workflow stays PENDING with `GATE_ERROR` and no receipt claims RELEASED (B17).

**Why.** A receipt is a statement about what was applied. A decision that was not applied must not appear as an applied action.

## BN-008 — Amendments, not rewrites

**Decision.** Evidence that changes a finalized result (late delivery, human review) triggers a new final evaluation. If the verdict or action changes, a new receipt `SSR-n-v2` is issued with `supersedes: SSR-n`. The original receipt is kept unchanged.

**Why.** Auditors need to see that the decision changed and why (B19, B23, B24).

## BN-009 — Human review acts on evidence, never on outcomes

**Decision.** The review API accepts CONFIRM, REJECT or LEAVE_UNRESOLVED on an evidence candidate. A confirmed candidate becomes `HUMAN_CONFIRMED` evidence and the engine re-evaluates. There is no endpoint to set a verdict or force a release.

**Why.** The Sequence Integrity Engine stays the only authority on verdicts and the policy stays the only authority on actions.

## BN-010 — AI boundary enforced in three layers

**Decision.** The AI boundary is enforced in three places:

1. The interpreter output schema is strict: no verdict or action field, and extra keys are rejected (B13).
2. On Bedrock, Converse is called with a forced `record_evidence_assessment` tool, so the model can only return that structure.
3. IAM: the sequence-evaluator, policy-evaluator, operational-gate and receipt-generator roles carry an explicit `Deny bedrock:*`.

Bedrock is off by default (`ENABLE_BEDROCK_EVIDENCE=false`).

**Why.** "AI proposes evidence, it cannot seal or release" must hold even if a prompt is manipulated (B13b) or the model is unavailable (B12 → UNCERTAIN).

**Note.** The benchmark and the local demo use a deterministic mock interpreter driven by fixture hints. This keeps results reproducible; it does not measure model quality.

## BN-011 — Replay runs are isolated by run id

**Decision.** A replay `run_id` is part of every idempotency key (`event:<profile>:<run>:<id>`) and of the source-health key.

**Why.** Found while hardening the Winning Moment. A 10× loop that reused one run id was correctly deduplicated by idempotency after the first iteration, so iterations 2–10 created nothing. Each demo run is now a distinct set of source events, while duplicates *within* a run are still collapsed (B06, B22).

## BN-012 — PWPS 0.1 durations: D, H, M, S only

**Decision.** `WITHIN` accepts ISO 8601 durations with day, hour, minute and second designators only (`PWPS-E030` otherwise).

**Why.** Years, months and weeks have no fixed length and have no place in a physical timing window. The hash would be stable while the meaning drifted.

## BN-013 — Invalid policy blocks startup

**Decision.** `loadActionPolicy` validates the `safe-mvp` profile, and `POLICY_INVALID` stops the pipeline from starting.

**Why.** A policy mapping DEVIATED → RELEASE (`policies/examples/invalid-deviated-release.yaml`, B14) must never be silently replaced by a default. The alternative policy `deviated-to-review.yaml` (v2.0.0) validates and shows that the action layer can change without touching the protocol.

## BN-014 — Scope cut: AgentCore, reconciliation and push updates

**Decision.** These flags from the specification are not implemented. The web UI polls the read API every 1.5–3 s.

**Why.** None of them is on the verification path, and each would add a failure mode to the demo. The flags are listed as reserved in `.env.example` so nobody assumes they work.

## BN-015 — One active execution per lane

**Decision.** The MVP correlates evidence to the single active execution in the inbound-receiving lane. A second independent ARRIVAL while one is active is a correlation ambiguity (REVIEW), not a second execution.

**Why.** General multi-delivery correlation is an open problem. Depth of verification for one constrained workflow was preferred over broad coverage that would have to guess.
