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

---

Decisions taken when aligning the implementation with the **SEQSEAL Implementation Master Brief** (the single source of truth from 2026-10-17 onward).

## BN-016 — The hero is a receiving checklist, not a verdict screen

**Decision.** The default screen shows Delivery A and Delivery B as receiving checklists (✓ Arrival 14:00 ✓ Staging 14:03 ✓ Storage 14:06). Each has a **Release delivery** button that is Unlocked or Locked, with "Wrong order" under B. The verdict tokens, lanes, evidence graph and hashes moved to the advanced execution view. Pressing a Release button reveals the exact rule (expected against observed) and the explanation chain. A 12-second walkthrough plays the brief's §5 sequence over the real results.

**Why.** Brief §2, §23 and §53: the first wow must be the familiar artifact, not PWPS, the receipt or the architecture. A cold viewer must understand within about 12 seconds why B stays locked.

**How the button stays honest.** It mirrors the `ReceivingWorkflow` state the Operational Gate applied (RELEASED → Unlocked; HELD, WAITING, REVIEW_REQUIRED or PENDING → Locked, with the reason). Pressing it never changes state.

## BN-017 — Hero shows three states; the engine evaluates five

**Decision.** The checklist lists the hero protocol ARRIVAL → STAGING → STORAGE in observed order. DEPARTURE and CLEAR appear in a quiet "Also checked" line. The verdict is always computed on the full IDP-01 (five states, eleven rules).

**Why.** Brief §10: less cognitive load in the hero, while the five-state protocol stays in the product and the benchmark. Hiding the last two states entirely would make an INCOMPLETE delivery look fully checked and still locked, without a visible reason.

## BN-018 — Receipt fields follow the brief; explanation chain is deterministic

**Decision.** Receipts carry the §34 field names (`protocol_id`, `protocol_version`, `protocol_hash`, `action_policy_*`, `operational_decision_id`, `operational_action`, `source_evidence_refs`, `receipt_hash`). They also carry the hash of the bindings and mappings in force (`source_config_hash`) and an `explanation_chain` built by `buildExplanationChain` from the evaluation, the decision and the evidence. The chain names the protocol's signature rule (its first declared failure condition, ORDER-02), read from the PWPS file.

**Why.** §35: "This chain must be reconstructable without an LLM." The mappings hash lets the Winning Moment test assert *same mappings* (§45), not only same protocol and policy. When a final HOLD only confirms an earlier provisional `WorkflowHeld`, the receipt names that establishing event and its decision.

## BN-019 — Evidence Graph derived from the rule timeline

**Decision.** The engine returns an `evidence_graph`, built from the exact timeline the PWPS rules are evaluated on:

- nodes: one per state, PRESENT, UNRESOLVED or ABSENT;
- observed edges: the temporal relation between every pair of present states, using the same precision semantics as the rules;
- protocol edges: each ordering or timing rule with its result.

**Why.** §7 and the implementation lock name the Evidence Graph as the observed model. Deriving it from the same timeline guarantees that the graph and the rule results can never disagree (tested). A separate graph engine could drift from the verdict.

## BN-020 — RING_DERIVED_REPLAY and captures grounded in Ring history events

**Decision.**

- A sixth source profile, `RING_DERIVED_REPLAY`, covers events that really came from Ring and are replayed later.
- `scripts/ring-spike.ts capture` now reads the device's event history right after a Playground simulation. It binds the capture to the newest Ring event not captured before: the event id becomes the source event, and its timestamp becomes the physical time. A re-capture of the same Ring event is deduplicated.
- If no new event appears within 60 s, the capture falls back to a status probe and says so.
- Every capture is appended to `fixtures/ring/captures/<session>.jsonl`. That session can be replayed through the normal pipeline (Monitor, or `pnpm replay --captures`) and is labelled Ring-derived replay.

**Why.**

- §25 lists the profile.
- §24 requires recording history behavior and IDs, and says "never build against assumed Playground behavior".
- Grounding the capture in the Ring event makes "hero evidence is traceable to Ring" (§55) true at the event level, not just at the API-call level.
- The saved session is demo fallback level 2.

**Not assumed.** The history parser is tolerant on purpose (JSON:API `data[]`, `events[]`, bare arrays; epoch-ms or ISO). The real shape must be confirmed during the spike and recorded in `ring-playground-observations.md`. It was confirmed on 2026-10-18: see BN-024.

## BN-021 — Benchmark aligned with §22, §43 and §44

**Decision.**

- **B15:** each OperationalDecision and ActionApplied is delivered three times.
- **Replay metrics:** verdict replay consistency and action replay consistency are measured separately.
- **First implementation goal:** 100 × A and 100 × B now run through the pipeline (was 10 × 10).
- **CI gates:** RELEASE ⇒ SEALED and "unsupported ⇒ never RELEASE" are now explicit per-scenario assertions.

The benchmark now has 32 scenarios.

**Why.** These are the brief's minimum list, its separate metrics and its CI safety gates. B15 existed implicitly inside B06 and B22, but "duplicate OperationalDecision" deserved its own scenario.

## BN-022 — BEDROCK_DISABLED kill switch

**Decision.** Bedrock is used only when all of these hold:

- `ENABLE_BEDROCK_EVIDENCE=true`;
- a model id is configured;
- `BEDROCK_DISABLED` is not `true`.

Terraform sets `BEDROCK_DISABLED=true` whenever Bedrock evidence is not enabled. Replays never fetch fresh media from Ring.

**Why.** §33: "The hero A/B path must work with BEDROCK_DISABLED=true." A single explicit switch is easier to audit than the absence of a flag.

## BN-023 — Working documents

**Decision.** The brief (§50) limits working documents to README, SPEC, BUILD_NOTES, EVALUATION, SAFETY, PRIVACY, FRICTION_LOG and CLAIMS. The following are kept as technical references, not product strategy:

- `ARCHITECTURE.md`, `RING_INTEGRATION.md`, `DEMO_SCRIPT.md`;
- `ring-playground-observations.md`, the Ring Source Spike record required by the original specification.

No new strategy document was added.

## BN-024 — Ring history time is `start`; capture guards

**Observed (2026-10-18, 16:21–16:23 UTC).** Playground history events are `history-events` items whose time is `attributes.start` and `attributes.end` in epoch milliseconds, with `event_type: "on_demand"` and an empty `cv_detections`. The parser read neither field, so the first two real captures took the capture time (26–32 s late). The same session also received the Arrival step twice, and SEQSEAL sent that delivery to review.

**Decision.**

- `latestHistoryEvent` reads `start` first, as the physical time, and keeps `end` as `ring_event.ended_at`. The observation records both (`time_source: ring history event start`, `ring_event_ended_at`). A test pins the verbatim shape.
- `start` rather than `end`, because the simulated vehicle or package appears at the start of the session.
- The capture command refuses the same simulation in the same zone twice in one session, unless `--again`. It ignores a history event that any saved session already captured, or that ended more than `--max-age` seconds ago (default 180), and waits for the new one.

**Why.**

- §24: build against observed Playground behavior, not assumed field names.
- The two guards close the two ways a live capture could put the wrong time or the wrong step into a delivery:
  - the newest history event can still be the previous step's until the new one is listed;
  - one keystroke can repeat a step.

  SEQSEAL already reacts safely to both (dedup by Ring event id, review on a second Arrival). Refusing them at capture time keeps a live demo on track.

