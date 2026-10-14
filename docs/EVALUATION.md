# Evaluation

How SEQSEAL is tested, what the benchmark measures and the latest results. The raw output of every run is written to `benchmarks/results/latest.{json,md}`.

```bash
pnpm benchmark            # run and write results
pnpm benchmark --check    # same, exit non-zero on any safety-metric regression (CI gate)
pnpm test                 # unit, conformance, golden, end-to-end, benchmark-gate tests
```

> These numbers come from 31 constructed scenarios on one protocol (IDP-01) and one policy (IDP-ACTION). They show that the implementation behaves as specified on those scenarios. They are **not** real-world accuracy figures. The interpreter in these runs is the deterministic mock (BUILD_NOTES BN-010), so model quality is not measured.

## 1. Test layers

| Layer | Where | What it proves |
|---|---|---|
| PWPS conformance | `packages/pwps/conformance`, `test/conformance.test.ts` | valid documents validate; 27 invalid documents fail with the expected `PWPS-E*` code; canonical forms and pinned hashes are stable; reference evaluation cases |
| Engine golden tests | `packages/engine-core/test/engine.test.ts` (T01–T10 and more) | verdict precedence, absence never FAIL, contested failures, timing windows, counterfactuals |
| Action policy | `packages/action-policy-core/test` | safe-MVP invariants, provisional rules, POLICY_INVALID cases |
| Evidence model | `packages/evidence-model/test` | bindings, mappings, acceptance policy, interpreter schema rejection |
| Ring adapter | `packages/ring-adapter/test` | HMAC over raw bytes, envelope parsing, normalization, Playground refusal without a 2xx call |
| AWS adapters | `packages/aws/test` | DynamoDB conditional writes, EventBridge batching, EMF format |
| End to end | `tests/pipeline.e2e.test.ts` | full pipeline through `ingestWebhook` |
| Winning Moment | `tests/winning-moment.spec.ts` | A → RELEASED and B → HELD, 10 consecutive runs, only ORDER-02 differs |
| Benchmark gate | `tests/benchmark-gate.spec.ts` | the benchmark's safety thresholds hold |

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
- **Supported** (10): the evidence proves a correct sequence, possibly with noise (duplicates, delays, unknown events). A HOLD here is a *false hold*.

## 3. Results

Run of 2026-10-14 (commit `04627b1`); protocol `IDP-01@1.0.0` (`sha256:6f0ad940…`), policy `IDP-ACTION@1.0.0` (`sha256:adfb18d6…`), engine `seqseal-engine@0.1.0`.

| Metric | Result |
|---|---|
| False SEALED (unsupported executions sealed) | **0 / 21** |
| False RELEASE (unsupported executions released) | **0 / 21** |
| False HOLD (supported executions held) | 0 / 10 |
| RELEASE without SEALED | 0 |
| Duplicate operational events | 0 |
| Verdict accuracy | 29 / 29 |
| Action accuracy | 28 / 28 |
| Receipt replay consistency (verdict, action, hashes) | 31 / 31 |
| Provenance completeness (evidence → observation → raw Ring event) | 140 / 140 |
| Engine determinism (100× A and 100× B, shuffled input order) | consistent |
| Pipeline reliability (10× A → RELEASED, 10× B → HELD) | 20 / 20 |
| Scenarios passing all assertions | 31 / 31 |
| Invalid policy DEVIATED → RELEASE (B14) | rejected, `POLICY_INVALID` |

`pnpm benchmark --check` (the release gate in CI) passes only if all of the following hold:

- every scenario passes;
- 0 false SEALED, 0 false RELEASE, 0 RELEASE-without-SEALED and 0 duplicate operational events;
- every receipt replays consistently and every evidence item is traceable to its raw source;
- the engine is deterministic and pipeline reliability is 20/20;
- both policy activation checks pass.

## 4. Scenarios

| ID | Scenario | Outcome |
|---|---|---|
| B01 | Execution A, correct sequence | SEALED → RELEASE |
| B02 | Execution B, STORAGE before STAGING | DEVIATED (ORDER-02) → HOLD |
| B03 | STAGING 8 min after ARRIVAL (limit 7) | DEVIATED (TEMP-01) → HOLD |
| B04 | Missing STAGING evidence | INCOMPLETE → WAIT |
| B05 | Ambiguous STAGING evidence | UNCERTAIN → REVIEW |
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
