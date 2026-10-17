# Safety

SEQSEAL controls whether a receiving workflow may proceed. Its most important failure is a **false release**: letting goods move on when the evidence does not prove the protocol was followed. Everything below is designed to make that failure structurally hard, and to fail toward WAIT, REVIEW or HOLD instead.

## 0. The critical invariant (Master Brief §14)

```
RELEASE ⇒ SEALED        There is no other automatic RELEASE path.

missing evidence   ≠ RELEASE      → INCOMPLETE → WAIT              (B04, B26)
ambiguous evidence ≠ RELEASE      → UNCERTAIN  → REVIEW            (B05, B09, B25)
source outage      ≠ RELEASE      → UNCERTAIN  → REVIEW            (B08)
AI failure         ≠ RELEASE      → UNCERTAIN  → REVIEW            (B12, B13, B13b)
engine failure     ≠ RELEASE      → system error, workflow PENDING (B16)
gate failure       ≠ RELEASED     → no receipt claims the action   (B17)
```

The CI gate checks this scenario by scenario. If the action is RELEASE, the verdict must be SEALED. For an unsupported scenario, the action must never be RELEASE, at any point in the workflow history (`tests/benchmark-gate.spec.ts`).

### What HOLD means (§15)

In this MVP, HOLD means that **the application-level receiving workflow cannot proceed automatically**. The Release delivery button stays locked and `WorkflowHeld` is emitted. HOLD does not:

- physically lock a door;
- stop machinery;
- detain a person;
- reject a payment.

The action is kept safe and demonstrable on purpose.

## 1. Invariants

| Invariant | Enforced by | Tested by |
|---|---|---|
| Only a FINAL **SEALED** evaluation can lead to RELEASE | `validateActionPolicy` (safe-mvp profile), `decide` throws `ReleaseInvariantViolation` | action-policy tests, B14, benchmark "RELEASE without SEALED = 0" |
| RELEASE is never applied provisionally | policy validation (`provisional_actions` cannot contain RELEASE), `decide` defers RELEASE until finalization | action-policy tests ("RELEASE is never applied provisionally") |
| Missing evidence is never a violation | engine: absence makes a rule NOT_EVALUABLE, never FAIL | engine golden tests, B04, B26 |
| A violation must be proven by accepted evidence | engine: FAIL requires positive evidence; contested FAIL → UNCERTAIN | B08, B09, B20, B25 |
| AI cannot produce a verdict or action | strict interpreter schema (no verdict, release, hold or action field), forced tool use, IAM `Deny bedrock:*` on decision roles, `BEDROCK_DISABLED=true` kill switch | B12, B13, B13b, aws tests |
| Errors are not verdicts | `system_error` on the execution; no decision or receipt claims an unapplied action | B16, B17 |
| Unauthenticated Ring traffic is ignored | HMAC-SHA256 over raw bytes, constant-time comparison | B11, ring-adapter tests |
| Duplicates cannot multiply actions | idempotency keys on deliveries, events, Ring history events, evidence, decisions and receipts | B06, B15, B22 |
| Decisions are reproducible | pure engine, hashed inputs, receipt replay (verdict and action separately) | 32/32 replay and action replay, determinism check |
| The Release button cannot release anything | the UI only mirrors the `ReceivingWorkflow` state the Operational Gate applied; pressing it shows the reason | UI code (`components/DeliveryChecklist.tsx`) |
| Invalid protocol or policy stops the system | `PROTOCOL_INVALID` / `POLICY_INVALID` at load, no permissive fallback | conformance suite, B14 |

## 2. Failure modes and what SEQSEAL does

| Situation | Verdict / state | Action | Why this is safe |
|---|---|---|---|
| Required step never observed, cameras healthy | INCOMPLETE | WAIT | absence is not proof of a violation, nor of compliance |
| Camera offline in the window | UNCERTAIN (coverage gap) | REVIEW | nobody can know; a person decides |
| Evidence ambiguous or AI unsure | UNCERTAIN | REVIEW | AI evidence is accepted only as SUPPORTED with HIGH quality |
| Timestamps cannot be ordered | UNCERTAIN | REVIEW | precision is explicit (±30 s fallback) |
| Two deliveries overlap in a lane | UNCERTAIN (correlation ambiguity) | REVIEW | SEQSEAL does not guess which evidence belongs to whom |
| Order or timing violation proven | DEVIATED | HOLD (applied immediately, provisional) | a proven violation stops the workflow early |
| Bedrock unavailable | candidate UNRESOLVED → UNCERTAIN | REVIEW | the AI path never fails open |
| Engine or gate error | system error, workflow stays PENDING | none | an error is not evidence of anything |
| Evidence arrives after finalization | new final evaluation | amended receipt `-v2` | the history stays visible |

## 3. Human review

Reviewers act on **evidence candidates**, never on outcomes (CONFIRM, REJECT, LEAVE_UNRESOLVED). After a CONFIRM the engine re-evaluates the whole protocol; the release still has to come from a SEALED verdict and the policy. There is no override endpoint. Each review is recorded as `EvidenceReview` with a reviewer reference, and the confirmed evidence is marked `HUMAN_CONFIRMED` in the receipt.

## 4. Demo controls

The demo orchestrator (`services/demo-orchestrator`, `/api/demo/*` locally) can only replay Ring-shaped source events and close executions (one, or every active replay execution on reset; locally, reset also clears the in-memory store). It cannot set a verdict, an action or a workflow status. Replayed data is always labelled:

- `FIXTURE_REPLAY` (test fixture) for hand-written fixtures;
- `RING_DERIVED_REPLAY` for saved Ring captures replayed later.

Neither is ever shown as live Ring data. On AWS the endpoint requires the `x-seqseal-demo-token` header, whose value lives in Secrets Manager.

## 5. Residual risks

- **Ring's own classification.** A wrong `subType` from Ring, mapped deterministically, becomes wrong evidence. Mappings are deliberately conservative, and the most consequential states (ARRIVAL, DEPARTURE, CLEAR) exclude AI-assisted evidence.
- **Camera placement.** A binding asserts that a device watches a zone. If the camera is moved, evidence is misattributed. Device health events are tracked, but physical re-aiming is not detectable.
- **Correlation.** One active execution per lane (BUILD_NOTES BN-015). Busy docks with interleaved deliveries will see frequent REVIEW.
- **Clock skew.** Ring timestamps are trusted as physical time. Skew between devices beyond the stated precision could mis-order events.

See [CLAIMS.md](CLAIMS.md) for what SEQSEAL does not claim.
