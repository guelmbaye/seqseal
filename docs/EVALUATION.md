# Evaluation

How SEQSEAL is tested, what the benchmark measures and the latest results. The raw output of every run is written to `benchmarks/results/latest.{json,md}`.

```bash
pnpm benchmark            # run and write results
pnpm benchmark --check    # same, exit non-zero on any safety-metric regression (CI gate)
pnpm test                 # unit, conformance, golden, end-to-end, benchmark-gate tests
```

> These numbers come from 32 constructed scenarios on one protocol (IDP-01) and one policy (IDP-ACTION). They show that the implementation behaves as specified on those scenarios. They are **not** real-world accuracy figures. The interpreter in these runs is the deterministic mock (BUILD_NOTES BN-010), so model quality is not measured.

## 1. Test layers

| Layer | Where | What it proves |
|---|---|---|
| PWPS conformance | `packages/pwps/conformance`, `test/conformance.test.ts` | valid documents validate; 27 invalid documents fail with the expected `PWPS-E*` code; canonical forms and pinned hashes are stable; reference evaluation cases |
| Engine golden tests | `packages/engine-core/test/engine.test.ts` (T01–T10 and more) | verdict precedence, absence never FAIL, contested failures, timing windows, counterfactuals |
| Action policy | `packages/action-policy-core/test` | safe-MVP invariants, provisional rules, POLICY_INVALID cases |
| Evidence model | `packages/evidence-model/test` | bindings, mappings, acceptance policy, interpreter schema rejection |
| Ring adapter | `packages/ring-adapter/test` | HMAC over raw bytes, envelope parsing, normalization, Playground refusal without a 2xx call |
| AWS adapters | `packages/aws/test` | DynamoDB conditional writes, EventBridge batching, EMF format |
| End to end | `tests/pipeline.e2e.test.ts` | full pipeline through `ingestWebhook` and Playground captures; Ring-history-grounded captures; Ring-derived replay; the checklist hero following a live session; log redaction |
| Winning Moment | `tests/winning-moment.spec.ts` | same protocol, policy, engine and mappings (source config hash); A → RELEASED and B → HELD with only ORDER-02 differing; receipt explanation chain; Evidence Graph agrees with ORDER-02; 100 × A and 100 × B through `evaluate` + `actionFor`; 10 × A/B through the pipeline with every receipt replayed |
| Benchmark gate | `tests/benchmark-gate.spec.ts` | all safety thresholds, plus the Master Brief §45 gates scenario by scenario: RELEASE ⇒ SEALED, unsupported ⇒ never RELEASE |

## 2. Benchmark design

Each scenario in `benchmarks/scenarios/` is a list of Ring-shaped source deliveries plus assertions. Deliveries can be:

- reordered, duplicated or delayed;
- unsigned or wrongly signed;
- carrying fault injections (engine throws, gate fails, model unavailable).

They enter through the same entry points as live traffic. The expected outcome covers:

- verdict and action, and the primary failing rule;
- receipt versions, operational events emitted, and the absence of an execution where that is expected.

Two families of scenarios define the safety metrics:

- **Unsupported** (21): the evidence does not prove a correct sequence. A SEALED or RELEASE here is a *false release*, the failure SEQSEAL exists to prevent.
- **Supported** (11): the evidence proves a correct sequence, possibly with noise (duplicates, delays, unknown events, redelivered decisions). A HOLD here is a *false hold*.

Coverage of the Master Brief §43 minimum list:

| Brief item | Scenarios |
|---|---|
| correct sequence | B01 |
| wrong sequence | B02 |
| timing violation | B03, B30 |
| missing evidence | B04, B26 |
| ambiguous evidence | B05 |
| duplicate events | B06, B22 |
| network reordering | B07, B18 |
| source outage | B08 |
| equal timestamps | B09, B25 |
| unknown Ring event | B10 |
| invalid signature | B11 |
| Bedrock failure | B12 |
| malformed AI response | B13, B13b |
| invalid ActionPolicy | B14 |
| duplicate OperationalDecision | B15 |
| engine failure | B16 |
| Gate failure | B17 |
| late evidence | B18, B19 |
| correlation ambiguity | B20 |

## 3. Results

Run of 2026-10-17. The exact commit is recorded at the top of `benchmarks/results/latest.md`. Protocol `IDP-01@1.0.0` (`sha256:6f0ad940…`), policy `IDP-ACTION@1.0.0` (`sha256:adfb18d6…`), engine `seqseal-engine@0.1.0`.

| Metric (Master Brief §44) | Result |
|---|---|
| False SEALED rate (unsupported deliveries sealed) | **0 / 21** |
| False RELEASE rate (unsupported deliveries released) | **0 / 21** |
| False HOLD rate (supported deliveries held) | 0 / 11 |
| Verdict accuracy | 30 / 30 |
| Action accuracy | 29 / 29 |
| Replay consistency (same protocol + evidence + engine → same verdict) | 32 / 32 |
| Action replay consistency (+ same policy → same action) | 32 / 32 |
| Receipt replay, every check including the receipt hash | 32 / 32 |
| Provenance completeness (evidence → observation → raw Ring event) | 145 / 145 |
| RELEASE without SEALED | 0 |
| Duplicate operational events | 0 |
| Engine determinism (100 × A and 100 × B, shuffled input order) | consistent |
| First implementation goal (§22): 100 × A → SEALED → RELEASE | 100 / 100 |
| First implementation goal (§22): 100 × B → DEVIATED → HOLD | 100 / 100 |
| Scenarios passing all assertions | 32 / 32 |
| Invalid policy DEVIATED → RELEASE (B14) | rejected, `POLICY_INVALID` |

`pnpm benchmark --check` (the release gate in CI) passes only if all of the following hold:

- every scenario passes;
- 0 false SEALED, 0 false RELEASE, 0 RELEASE-without-SEALED and 0 duplicate operational events;
- verdict replay, action replay and full receipt replay are all 100 %, and every evidence item is traceable to its raw source;
- the engine is deterministic and 100 / 100 runs of A and of B reach the expected verdict and action;
- both policy activation checks pass.

## 4. Scenarios

| ID | Scenario | Outcome |
|---|---|---|
| B01 | Execution A, correct sequence | SEALED → RELEASE |
| B02 | Execution B, STORAGE before STAGING | DEVIATED (ORDER-02) → HOLD |
| B03 | STAGING 8 min after ARRIVAL (limit 7) | DEVIATED (TEMP-01) → HOLD |
| B04 | Fixture C: CLEAR never observed, coverage healthy | INCOMPLETE → WAIT |
| B05 | Fixture D: STAGING cannot be reliably established | UNCERTAIN → REVIEW |
| B06 | Duplicate deliveries and re-sent events | SEALED → RELEASE, one evidence item each |
| B07 | Delivery order differs from physical order | SEALED → RELEASE |
| B08 | Staging camera offline in the expected window | UNCERTAIN → REVIEW |
| B09 | STAGING and STORAGE timestamps indistinguishable | UNCERTAIN → REVIEW |
| B10 | Unknown future Ring event type | stored, never a state; SEALED → RELEASE |
| B11 | Invalid `X-Signature` | no execution |
| B11b | Correctly signed webhooks end to end | SEALED → RELEASE |
| B12 | AI interpretation needed, model unavailable | UNCERTAIN → REVIEW |
| B13 | Model output adds verdict / release fields | rejected by schema; UNCERTAIN → REVIEW |
| B13b | Scene text tries to make the model invent a state | UNCERTAIN → REVIEW |
| B15 | Each OperationalDecision and ActionApplied delivered three times | one WorkflowReleased, one receipt |
| B16 | Engine throws | system error, no verdict, no receipt |
| B17 | Gate fails after a valid RELEASE decision | PENDING (GATE_ERROR), no receipt |
| B18 | STAGING delivered after DEPARTURE but occurred before STORAGE | SEALED → RELEASE |
| B19 | Late STAGING after finalization | receipt v2 supersedes v1 |
| B20 | Second independent ARRIVAL during an execution | UNCERTAIN → REVIEW |
| B21 | AI-assisted STAGING, SUPPORTED / HIGH | accepted; SEALED → RELEASE |
| B22 | Wrong order with duplicate deliveries | exactly one `WorkflowHeld` |
| B23 | Reviewer confirms ambiguous STAGING | re-evaluation, SEALED → RELEASE, receipt v2 |
| B24 | Reviewer rejects ambiguous STAGING | INCOMPLETE → WAIT, receipt v2 |
| B25 | STAGING without physical timestamp (±30 s) vs STORAGE 20 s later | UNCERTAIN → REVIEW |
| B26 | STAGING never observed, coverage healthy | INCOMPLETE → WAIT |
| B27 | Ordering violation proven before the sequence completes | DEVIATED → HOLD at deadline |
| B28 | Repeated STAGING observations | first occurrence governs; SEALED → RELEASE |
| B29 | Vehicle departs before storage completes | DEVIATED (ORDER-03) → HOLD |
| B30 | Dock cleared 20 min after departure (limit 15) | DEVIATED (TEMP-02) → HOLD |
| B31 | Staging-like motion from an unbound device | retained, never evidence; INCOMPLETE → WAIT |

## 5. What is not evaluated

- Accuracy of Ring's own motion classification, and of any Bedrock model, on real footage.
- Throughput and latency on AWS. The deployment has not been load-tested.
- Multiple concurrent deliveries in one lane (BUILD_NOTES BN-015).
