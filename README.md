<p align="center"><img src="apps/web/public/brand/seqseal-logo.png" alt="SEQSEAL" width="320"></p>

# SEQSEAL — a checklist that can see

*Verify the sequence. Seal the workflow.*

**Every box is checked. Release is still locked.**

A receiving checklist can show ✓ Arrival ✓ Staging ✓ Storage while the dock actually did Arrival → **Storage → Staging**. Every box is checked, and the process is still wrong.

SEQSEAL gives the receiving checklist eyes. Ring observes what actually happened at the dock. SEQSEAL verifies that the steps occurred in the required order, and **Release delivery** unlocks only when they did.

| | Checklist | Release delivery |
|---|---|---|
| Delivery A | ✓ Arrival 14:00 · ✓ Staging 14:03 · ✓ Storage 14:06 | **Unlocked** — ORDER-02 passed, SEALED → RELEASE |
| Delivery B | ✓ Arrival 14:00 · ✓ Storage 14:03 · ✓ Staging 14:06 | **Locked** — ORDER-02 failed (STAGING must occur before STORAGE), DEVIATED → HOLD |

Same observations. Different sequence. Different operational action.

AI can propose evidence. It cannot release the workflow.

---

## See it in 12 seconds (local, no cloud account)

Requirements: Node.js 22+, pnpm 10.

```bash
pnpm install
pnpm demo                      # http://localhost:3000, the full pipeline runs in-process
```

1. Press **Run deliveries A and B**. Two deliveries replay Ring-shaped source events through the real pipeline. The checklists fill in as evidence arrives, and the Release buttons follow the receiving workflow state the Operational Gate applies.
2. Press **Release delivery** on Delivery B to see why it is locked: the exact rule, what was expected, what was observed, and the explanation chain down to the evidence.
3. Press **Play the 12-second walkthrough** for the guided version, played over the real results.

The demo data is labelled **Test fixture (Ring-shaped replay)** everywhere it appears. Live Ring Playground captures show **Ring Developer Playground**, and saved Ring captures replayed later show **Ring-derived replay**. See [docs/RING_INTEGRATION.md](docs/RING_INTEGRATION.md).

Without a browser:

```bash
pnpm demo:headless             # A → SEALED → RELEASE, B → ORDER-02 FAIL → DEVIATED → HOLD, with the receipt chain
pnpm benchmark                 # 32 scenarios + safety metrics → benchmarks/results/latest.md
```

## How it works

Ring provides physical observations. PWPS defines the expected execution. SEQSEAL builds traceable evidence and evaluates the sequence deterministically. A separate, versioned policy converts the resulting verdict into an operational action.

```
Ring observation → normalized observation → evidence candidate → accepted evidence
  → Evidence Graph (observed) vs PWPS protocol graph (expected)
  → Sequence Integrity Engine → verdict
  → Action Policy Engine → action
  → Operational Gate → WorkflowReleased / WorkflowHeld → receiving workflow
  → SeqSeal Receipt
```

- **The protocol is data, not code.** `protocols/inbound-delivery.yaml` (IDP-01@1.0.0) is written in PWPS 0.1, our open-source Physical Workflow Protocol Specification. The signature rule is ORDER-02: STAGING must occur before STORAGE. The engine reads this file at runtime; ORDER-02 is not hard-coded anywhere.
- **Four verdicts.**
  - SEALED: every mandatory requirement is supported.
  - DEVIATED: accepted evidence proves a violation.
  - INCOMPLETE: required evidence is absent while the cameras were healthy.
  - UNCERTAIN: the evidence is ambiguous or camera coverage was compromised.
- **Four actions, set by a separate policy.** `policies/inbound-delivery-default.yaml` (IDP-ACTION@1.0.0) maps SEALED → RELEASE, DEVIATED → HOLD, INCOMPLETE → WAIT and UNCERTAIN → REVIEW.
- **The action is real.** The Operational Gate moves a `ReceivingWorkflow` from PENDING to RELEASED, HELD, WAITING or REVIEW_REQUIRED, and emits `WorkflowReleased` or `WorkflowHeld` as domain events. The Release button only mirrors that state.
- **HOLD is safe and application-level.** It means the receiving workflow cannot proceed automatically. It does not lock a door, stop machinery, detain anyone or reject a payment.

## Why trust the verdict

Evidence → Rule → Verdict → Policy → Action → Receipt. Every step is recorded and can be replayed.

Every finalized delivery produces a **SeqSeal Receipt**. It holds the protocol, evidence set and policy, each with its hash, plus the engine version, rule results, verdict, decision, applied action and source evidence references. It also holds an explanation chain that is rebuilt without any model:

```
HOLD
because  Action policy IDP-ACTION@1.0.0 maps DEVIATED → HOLD
because  ORDER-02 failed: STAGING must occur before STORAGE
because  STORAGE 14:03 occurred before STAGING 14:06
based on Ring-shaped test fixture evidence
```

Guarantees this implementation enforces, each tested:

- **Only SEALED may RELEASE**, and only on a final evaluation. A policy that maps anything else to RELEASE fails validation and blocks startup.
- **What never leads to RELEASE:** missing evidence, ambiguous evidence, a source outage, an AI failure or an engine failure.
- **Absence is never a violation.** A camera outage is never treated as proof that a step did not happen.
- **AI is confined to evidence.** The Bedrock output schema has no verdict, release, hold or action field. On AWS, the decision functions carry an explicit `Deny bedrock:*`, and `BEDROCK_DISABLED=true` turns Bedrock off entirely. The hero path never needs it.
- **Physical time, not delivery order.** Late or reordered Ring deliveries do not change the verdict.
- **Duplicates are harmless.** Repeated deliveries, events and operational decisions produce one action and one receipt.

## Results on the defined benchmark

These are measured on 32 constructed scenarios. They are not real-world accuracy claims. Details are in [docs/EVALUATION.md](docs/EVALUATION.md).

| Metric | Result |
|---|---|
| False RELEASE (unsupported deliveries released) | **0 / 21** |
| False SEALED | **0 / 21** |
| False HOLD | 0 / 11 |
| Replay consistency / action replay consistency | 32 / 32 · 32 / 32 |
| Provenance completeness | 145 / 145 |
| 100 × A → SEALED → RELEASE · 100 × B → DEVIATED → HOLD | 100 / 100 · 100 / 100 |

## What is in the box

```
packages/
  pwps/                 @pwps/core: PWPS 0.1 spec, JSON Schema, parser, validator, canonical hash,
                        compiler, reference evaluator, CLI, conformance suite (Apache-2.0, usable on its own)
  contracts/            shared zod schemas, enums, domain events, receipt contract
  engine-core/          Sequence Integrity Engine: evaluate(protocol, evidence), Evidence Graph
  action-policy-core/   Action Policy Engine: actionFor(verdict, policy) / decide(), safe-MVP invariants
  evidence-model/       bindings, deterministic mappings, acceptance policy, AI interpreter boundary
  ring-adapter/         webhook HMAC + JSON:API envelope, normalization, Playground captures, API client
  pipeline/             event-driven orchestration, Operational Gate, receipts, replay, read model
  aws/                  DynamoDB, EventBridge, S3, Secrets Manager, Bedrock, EMF metrics, Lambda glue
services/               13 Lambda entry points (one per pipeline stage)
apps/web/               the checklist UI and its local backend
protocols/              inbound-delivery.yaml (IDP-01@1.0.0)
policies/               action policy, evidence acceptance policy, examples
config/                 Ring source bindings and evidence mappings
fixtures/scenarios/     test fixtures A (correct), B (wrong order), C (missing), D (ambiguous)
benchmarks/             32-scenario benchmark harness and results
infrastructure/terraform/   AWS deployment (dev, demo)
docs/                   evaluation, safety, privacy, claims, build notes, friction log, Ring integration
```

## Commands

| Command | What it does |
|---|---|
| `pnpm demo` | Checklist UI with the in-process pipeline |
| `pnpm test` | Unit, conformance, golden, end-to-end and benchmark-gate tests |
| `pnpm test:winning` | Winning Moment acceptance: same protocol, policy and mappings; A → RELEASE, B → HOLD; 100× and 10× runs |
| `pnpm benchmark --check` | Run the benchmark and fail on any safety regression |
| `pnpm pwps validate <file>` | Validate a PWPS protocol (`inspect`, `hash`, `canonicalize`, `compile` and `eval` are also available) |
| `pnpm replay --scenario <id>` | Replay a test fixture headlessly, or against a deployment with `--remote` |
| `pnpm replay --captures <file.jsonl>` | Ring-derived replay of a saved Ring Playground session |
| `pnpm tsx scripts/ring-spike.ts discover \| history \| capture …` | Ring Source Spike: inspect the Ring API and its event history, capture one Playground simulation |
| `pnpm tsx scripts/ring-spike.ts run --device <id> --post <url> --delivery A\|B` | Live delivery, guided: says which Playground simulation to click for each step and ends with SEQSEAL's verdict |
| `pnpm sign-webhook --url … --secret …` | Send a correctly signed Ring-shaped webhook to a SEQSEAL endpoint |
| `pnpm build:lambdas` | Bundle the 13 Lambda functions |
| `pnpm verify` | Everything CI runs: lint, typecheck, tests, benchmark gate, protocol validation, builds, Terraform parse |

## Deploy to AWS

```bash
pnpm build:lambdas
cd infrastructure/terraform/environments/demo
terraform init && terraform apply
```

Then set the three secrets (Ring webhook signing key, Ring API token, demo token). Register `webhook_url` with Ring if you have a Ring app. Point the UI at the API:

```bash
SEQSEAL_BACKEND=remote SEQSEAL_API_URL=<api_endpoint> SEQSEAL_DEMO_TOKEN=<token> pnpm demo
```

The architecture is API Gateway, Lambda, EventBridge, SQS with DLQs, DynamoDB, S3 (SSE-KMS), Secrets Manager, per-function IAM and CloudWatch. Bedrock is optional, sits on a side branch, and is off by default. The full guide is [infrastructure/terraform/README.md](infrastructure/terraform/README.md).

## What SEQSEAL is not

It is not a WMS, an ERP, generic video analytics, employee surveillance, a biometric system, an access-control controller, a universal SOP engine, process mining or an AI agent platform.

It proves one narrow thing deeply: whether a Ring-observed physical receiving workflow happened in the required sequence before the business workflow proceeds. The MVP handles one active delivery per receiving lane.

## Documentation

- [docs/EVALUATION.md](docs/EVALUATION.md): benchmark design and results
- [docs/SAFETY.md](docs/SAFETY.md) and [docs/PRIVACY.md](docs/PRIVACY.md)
- [docs/CLAIMS.md](docs/CLAIMS.md): what SEQSEAL does and does not claim
- [docs/BUILD_NOTES.md](docs/BUILD_NOTES.md) and [docs/FRICTION_LOG.md](docs/FRICTION_LOG.md)
- [docs/RING_INTEGRATION.md](docs/RING_INTEGRATION.md) and [docs/ring-playground-observations.md](docs/ring-playground-observations.md): source profiles and the Ring Source Spike record
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, events, data model, AWS mapping
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): the 12-second opening and the 3-minute video
- [packages/pwps/SPEC.md](packages/pwps/SPEC.md): PWPS 0.1 specification

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Ring is a trademark of Ring LLC; SEQSEAL is not affiliated with or endorsed by Ring or Amazon.
