# SEQSEAL benchmark results — seqseal-benchmark@0.1.0

Generated 2026-10-14T13:03:03.387Z · commit `uncommitted`

Protocol `IDP-01@1.0.0` (sha256:6f0ad940aa34…) · Action policy `IDP-ACTION@1.0.0` (sha256:adfb18d6283f…) · seqseal-engine@0.1.0 · interpreter: mock-evidence-interpreter@1 (deterministic fixture hints)

> Engineering run on the defined benchmark only. These numbers are bounded to these 31 constructed scenarios; they are not real-world accuracy claims.

## Safety metrics

| Metric | Result |
|---|---|
| False SEALED (unsupported executions SEALED) | **0/21** |
| False RELEASE (unsupported executions RELEASED) | **0/21** |
| False HOLD (supported executions HELD) | 0/10 |
| RELEASE ⇒ SEALED violations | 0 |
| Duplicate operational events | 0 |
| Verdict accuracy | 29/29 (100.0%) |
| Action accuracy | 28/28 (100.0%) |
| Receipt replay consistency (verdict + action + hashes) | 31/31 (100.0%) |
| Provenance completeness (evidence → observation → raw source) | 140/140 (100.0%) |
| Engine determinism (100× A + 100× B, shuffled input order) | consistent |
| Pipeline reliability (10× A→RELEASED, 10× B→HELD) | 20/20 |
| Scenarios passing all assertions | 31/31 |

## Scenarios

| ID | Scenario | Expected | Observed | Primary rule | Receipts | Result |
|---|---|---|---|---|---|---|
| B01 | Execution A — Correct Sequence | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B02 | Execution B — Reordered Sequence | DEVIATED → HOLD | DEVIATED → HOLD | ORDER-02 | 1 | PASS |
| B03 | Temporal violation — STAGING 8 min after ARRIVAL (limit 7 min) | DEVIATED → HOLD | DEVIATED → HOLD | TEMP-01 | 1 | PASS |
| B04 | Execution C — Missing Evidence | INCOMPLETE → WAIT | INCOMPLETE → WAIT | — | 1 | PASS |
| B05 | Execution D — Ambiguous Evidence | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B06 | Duplicate Ring deliveries and re-sent events do not duplicate evidence or actions | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B07 | Network delivery order differs from physical order (STORAGE received first) | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B08 | Staging camera offline during the window where STAGING was expected | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B09 | STAGING and STORAGE timestamps indistinguishable | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B10 | Unknown future Ring event type is stored but never becomes a workflow state | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B11 | Valid-looking Ring webhooks with an invalid X-Signature | no execution | no execution | — | 0 | PASS |
| B11b | Signed Ring webhooks (RING_WEBHOOK profile) pass HMAC verification end to end | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B12 | AI interpretation required for STAGING but the model is unavailable | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B13 | Model output tries to add verdict/release fields — strict schema rejects it | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B13b | Scene text tries to make the model invent a different workflow state | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B16 | Sequence Integrity Engine throws — system error, never a semantic verdict | system error ENGINE_ERROR | — → PENDING (ENGINE_ERROR) | — | 0 | PASS |
| B17 | Operational Gate fails after a valid RELEASE decision — receipt must not claim RELEASED | SEALED | SEALED → PENDING (GATE_ERROR) | — | 0 | PASS |
| B18 | STAGING delivered late (after DEPARTURE) but occurred before STORAGE | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B19 | Late STAGING evidence after finalization creates an amendment (Receipt v2), never a silent rewrite | DEVIATED → HOLD | DEVIATED → HOLD | ORDER-02 | 2 | PASS |
| B20 | A second independent ARRIVAL while an execution is active | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B21 | AI-assisted STAGING evidence, SUPPORTED/HIGH, accepted by the evidence acceptance policy | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B22 | Wrong order with duplicate deliveries — exactly one WorkflowHeld | DEVIATED → HOLD | DEVIATED → HOLD | ORDER-02 | 1 | PASS |
| B23 | Human reviewer confirms ambiguous STAGING evidence → deterministic re-evaluation → amendment | SEALED → RELEASE | SEALED → RELEASE | — | 2 | PASS |
| B24 | Human reviewer rejects ambiguous STAGING evidence → STAGING absent → INCOMPLETE | INCOMPLETE → WAIT | INCOMPLETE → WAIT | — | 2 | PASS |
| B25 | STAGING without physical timestamp — send-time fallback (±30 s) cannot order it against STORAGE 20 s later | UNCERTAIN → REVIEW | UNCERTAIN → REVIEW | — | 1 | PASS |
| B26 | STAGING never observed (coverage healthy), CLEAR closes the sequence | INCOMPLETE → WAIT | INCOMPLETE → WAIT | — | 1 | PASS |
| B27 | Ordering violation proven before the sequence completes; deadline reached without CLEAR | DEVIATED → HOLD | DEVIATED → HOLD | ORDER-02 | 1 | PASS |
| B28 | Repeated legitimate STAGING observations — first accepted occurrence governs precedence | SEALED → RELEASE | SEALED → RELEASE | — | 1 | PASS |
| B29 | Vehicle departs before storage completes (ORDER-03) | DEVIATED → HOLD | DEVIATED → HOLD | ORDER-03 | 1 | PASS |
| B30 | Dock cleared 20 min after departure (TEMP-02 limit 15 min) | DEVIATED → HOLD | DEVIATED → HOLD | TEMP-02 | 1 | PASS |
| B31 | STAGING-like motion from a device with no source binding is retained but never becomes evidence | INCOMPLETE → WAIT | INCOMPLETE → WAIT | — | 1 | PASS |

## Action-policy activation checks

| ID | Policy | Expected | Observed |
|---|---|---|---|
| B14 | `../policies/examples/invalid-deviated-release.yaml` | POLICY_INVALID | POLICY_INVALID — mappings.DEVIATED: safe profile forbids DEVIATED → RELEASE (only SEALED may RELEASE) |
| A-V2 | `../policies/examples/deviated-to-review.yaml` | VALID | VALID |
