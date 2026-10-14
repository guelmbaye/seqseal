# SEQSEAL architecture

SEQSEAL turns Ring source events into a verified, gated and receipted operational decision. It is event-driven, the decision path is deterministic, and the same domain code runs in-process for the local demo and as separate Lambda functions on AWS.

## 1. The chain

```
Ring source event
  → RawSourceRecord          (verified, deduplicated, stored as received)
  → NormalizedObservation    (source-agnostic: device, zone, event type, occurred_at, precision)
  → EvidenceCandidate        (binding + mapping → semantic state of the protocol, or nothing)
  → Evidence                 (accepted by the evidence acceptance policy)
  → WorkflowEvaluation       V = f(P, E)   Sequence Integrity Engine
  → OperationalDecision      A = g(V, Π)   Action Policy Engine
  → ReceivingWorkflow        Operational Gate applies the action, emits a business event
  → SeqSealReceipt           hashes + evidence + rules + verdict + policy + applied action
```

Each arrow is an authority boundary. A stage may only write the artifact it owns:

| Stage | Owns | Must never |
|---|---|---|
| Ring adapter | raw records, observations | assign workflow states |
| Evidence resolver | candidates, evidence | evaluate rules |
| Media interpreter (optional AI) | candidate assessments | produce a verdict or an action |
| Sequence Integrity Engine | evaluations (verdict) | choose an action |
| Action Policy Engine | decisions (action) | change a verdict |
| Operational Gate | workflow status, business events | release without a final SEALED decision |
| Receipt generator | receipts | claim an action the gate did not apply |

## 2. Core engines

### PWPS — the protocol (`packages/pwps`)

A PWPS 0.1 document declares zones, states, constraints (`REQUIRED`, `BEFORE`, `AFTER`, `WITHIN`, `FORBIDDEN`) and evidence requirements. It says nothing about cameras, cloud services or business actions. The toolkit parses YAML/JSON with size, depth and alias limits, validates structure (JSON Schema) and semantics (unknown references, cyclic ordering, states both required and forbidden), emits stable `PWPS-Exxx` / `PWPS-Wxxx` diagnostics, canonicalizes to JSON and hashes with SHA-256. `compile()` produces the `CompiledProtocol` the engine consumes: expected sequence, opening state, and normalized rules (`REQUIRED`, `PRECEDENCE`, `WITHIN`, `FORBIDDEN_*`).

`protocols/inbound-delivery.yaml` (IDP-01@1.0.0):

```
ARRIVAL → STAGING → STORAGE → DEPARTURE → CLEAR (terminal)
REQ-01..05  every state required
ORDER-01..04  each state before the next
TEMP-01  STAGING within 7 min after ARRIVAL
TEMP-02  CLEAR within 15 min after DEPARTURE
```

### Sequence Integrity Engine (`packages/engine-core`)

`evaluateExecution({ protocol, evidence, unresolved, coverage, ambiguities, mode })` is a pure function. For each rule it returns PASS, FAIL or NOT_EVALUABLE with the evidence it used and a plain-language explanation. Rule results combine into a verdict by precedence:

```
DEVIATED  > UNCERTAIN > INCOMPLETE > SEALED
(proven     (ambiguity,   (required      (every mandatory
 violation)  coverage gap,  evidence       rule passes)
             contested)     missing)
```

- A FAIL needs positive evidence. Absence only ever makes a rule NOT_EVALUABLE.
- A FAIL that depends on ambiguous evidence or a coverage gap is *contested* and yields UNCERTAIN, not DEVIATED.
- Ordering uses physical `occurred_at` with its precision; two timestamps whose uncertainty intervals overlap cannot be ordered.
- The first accepted occurrence of a state governs precedence.
- Each evaluation carries `evidence_set_hash`, `input_hash`, the protocol hash and the engine version, plus a counterfactual ("if STAGING had occurred before STORAGE, ORDER-02 would have passed").

### Action Policy Engine (`packages/action-policy-core`)

`decide({ evaluation, policy })` maps the verdict to an action using a versioned YAML policy (`policies/inbound-delivery-default.yaml`, IDP-ACTION@1.0.0):

| Verdict | Action | Applied provisionally |
|---|---|---|
| SEALED | RELEASE | never, only on a FINAL evaluation |
| DEVIATED | HOLD | yes |
| INCOMPLETE | WAIT | yes |
| UNCERTAIN | REVIEW | yes |

The `safe-mvp` profile is enforced at load time: only SEALED may map to RELEASE, and RELEASE may not appear in `provisional_actions`. An invalid policy raises `POLICY_INVALID` and blocks startup instead of falling back to a permissive default. A `ReleaseInvariantViolation` is thrown if a RELEASE decision is ever requested for anything but a final SEALED evaluation.

### Evidence model (`packages/evidence-model`)

- **Bindings** (`config/inbound-delivery.sources.yaml`) map a Ring device, or a Playground `session_zone`, to a logical protocol zone, per source profile.
- **Mappings** turn an observation in a zone into a candidate state. They are tried in order: `DIRECT`, `CONFIGURED_MAPPING`, then `AI_ASSISTED`.
- The **acceptance policy** (`policies/evidence-acceptance-default.yaml`) accepts deterministic candidates and accepts AI candidates only when the assessment is SUPPORTED with HIGH quality. The protocol's `accepted_authority` can exclude AI for specific states (ARRIVAL, DEPARTURE and CLEAR in IDP-01).
- An observation from an unbound device is retained for audit but never becomes evidence.
- **Coverage** tracks source health windows, so an offline staging camera produces a coverage gap (UNCERTAIN) instead of a silent absence.

## 3. Pipeline (`packages/pipeline`)

`SeqSealPipeline.handle(event)` routes each domain event to its stage. All storage goes through the `DocDatabase` abstraction (in-memory locally, DynamoDB on AWS), and all publishing goes through an event bus (in-memory locally, EventBridge on AWS).

| Event (EventBridge `detail-type`) | Handler |
|---|---|
| `RingSourceEventReceived` (`seqseal.ring.source_event_received`) | normalize |
| `ObservationNormalized` | bind, map, create candidate or request interpretation |
| `EvidenceInterpretationRequested` | media interpreter (mock or Bedrock) |
| `EvidenceAccepted` / `EvidenceUnresolved` / `EvidenceReviewed` / `CorrelationAmbiguityDetected` / `SourceHealthChanged` | correlate to an execution, re-evaluate |
| `ExecutionFinalizationRequested` | final evaluation |
| `WorkflowEvaluated` (`seqseal.verification.completed`) | action policy |
| `OperationalDecisionCreated` | Operational Gate |
| `ActionApplied` | receipt (final decisions only) |

Business events emitted by the gate: `WorkflowReleased`, `WorkflowHeld`, `WorkflowReviewRequired`, `WorkflowAwaitingEvidence`. There is no generic "status changed" event.

### Executions and correlation

An execution opens on the protocol's opening state (ARRIVAL) in a lane and collects evidence until a terminal state (CLEAR), a deadline, or an explicit close. Evidence that arrives before its execution exists is held as an orphan and adopted when the execution opens. A second independent ARRIVAL while an execution is active is a correlation ambiguity, so the result is UNCERTAIN → REVIEW, never a guess.

### Idempotency

- Ring deliveries are deduplicated by `event:<id>` and `delivery:<request id>` keys.
- Candidates and evidence have content-derived IDs (`CAN-<STATE>-<8hex>`, `EV-…`).
- The gate claims `decision_id` before applying it.

Ten duplicate deliveries therefore produce one evidence item and one `WorkflowHeld`.

### Finalization and amendments

When a terminal state is observed, the execution is finalized after `FINALIZATION_GRACE_SECONDS`. On AWS, the `execution-sweeper` finalizes executions whose deadline passed. Evidence that arrives after finalization, including a human review, triggers a new final evaluation. If the result changes, a new receipt `SSR-n-v2` with `supersedes: SSR-n` is issued; the first receipt is never rewritten.

### Receipts and replay

`buildReceipt` records:

- the protocol and policy IDs, versions and hashes;
- the engine versions and the evidence set hash;
- the observed sequence, the rule results and the evidence provenance (evidence → observation → raw Ring event);
- the decision and the applied action.

The receipt is hashed over its canonical JSON. `replayReceipt` re-runs the engine on the stored input snapshot and checks verdict, action and every hash.

## 4. Runtimes

### Local (`LocalRuntime`, `apps/web`)

The web app's server routes host the whole pipeline in-process with an in-memory document database and event bus. `/integrations/ring/webhook` and `/integrations/ring/playground/capture` accept real Ring traffic locally as well. Demo controls replay fixture scenarios through the same entry points (`FIXTURE_REPLAY` profile); they never write a verdict.

### AWS (`packages/aws`, `services/*`, `infrastructure/terraform`)

```
Ring webhook ─► API Gateway ─► ring-ingest ─┐
Playground  ─► API Gateway ─► ring-playground-adapter ─┤ PutEvents
                                                       ▼
                                          EventBridge bus (archive 7 days)
                                                       │ rule per detail-type → SQS (+DLQ)
     observation-normalizer · evidence-resolver · media-interpreter · sequence-evaluator
     policy-evaluator · operational-gate · receipt-generator          execution-sweeper (5 min)
                                                       │
            DynamoDB (executions, evidence, config, idempotency+TTL) · S3 artifacts (SSE-KMS)
read-api / review-api / demo-orchestrator ◄─ API Gateway ◄─ web UI (SEQSEAL_BACKEND=remote)
```

- Every function has its own IAM role. The sequence-evaluator, policy-evaluator, operational-gate and receipt-generator roles carry an explicit `Deny bedrock:*`.
- Only `media-interpreter` may call Bedrock (Converse with a forced `record_evidence_assessment` tool). It can only write candidate assessments, and only when `ENABLE_BEDROCK_EVIDENCE=true`.
- Metrics are emitted in CloudWatch EMF. Alarms cover DLQ depth and Lambda errors.

## 5. Data model

All entities are zod schemas in `packages/contracts/src/domain.ts`. The schemas are used at every boundary, so a malformed record is rejected where it enters, not deep in the pipeline.

| Entity | Key | Notes |
|---|---|---|
| RawSourceRecord | `source_record_id` | raw body, headers subset, signature status, source profile |
| NormalizedObservation | `OBS-<10hex>` | device, zone binding, event type/subtype, `occurred_at`, precision |
| EvidenceCandidate | `CAN-<STATE>-<8hex>` | mode (DIRECT/CONFIGURED_MAPPING/AI_ASSISTED/HUMAN_CONFIRMED), status |
| Evidence | `EV-<STATE>-<8hex>` | accepted candidate with provenance refs |
| Execution | `EXEC-0001` | lane, status, source profiles, replay label, system error |
| WorkflowEvaluation | `EVAL-0001-01` | verdict, rule results, hashes, counterfactual |
| OperationalDecision | `DEC-0001-01` | action, policy ref and hash, final flag |
| ReceivingWorkflow | execution id | status and transition history |
| SeqSealReceipt | `SSR-0001`, `SSR-0001-v2` | canonical-JSON hash, supersedes |
| EvidenceReview | `REV-…` | CONFIRM / REJECT / LEAVE_UNRESOLVED on a candidate, never on a verdict |
