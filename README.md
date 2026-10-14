<p align="center"><img src="apps/web/public/brand/seqseal-logo.png" alt="SEQSEAL" width="320"></p>

# SEQSEAL — Physical Workflow Integrity

*Verify the sequence. Seal the workflow.*

SEQSEAL checks that a physical workflow happened **in the order it was supposed to**, using Ring camera evidence, before a business system is allowed to act on it.

Two inbound deliveries can contain exactly the same Ring events and still differ in the one thing that matters: whether goods were staged *before* they went into storage. SEQSEAL evaluates each delivery against a declared protocol (PWPS), derives a verdict, maps that verdict to an operational action through a separate, versioned policy, applies the action to the receiving workflow, and issues a replayable receipt.

```
Ring observes.  PWPS defines.  SEQSEAL verifies the sequence and gates what the workflow may do next.
```

| Execution | Ring events | Order | Verdict | Action | Workflow |
|---|---|---|---|---|---|
| A | arrival, staging, storage, departure, clear | as declared | **SEALED** | **RELEASE** | RELEASED |
| B | the same five events | storage before staging | **DEVIATED** (ORDER-02) | **HOLD** | HELD |

AI can propose evidence. It cannot seal or release a workflow.

---

## Quick start (local, no cloud account)

Requirements: Node.js 22+, pnpm 10.

```bash
pnpm install
pnpm demo                      # Next.js on http://localhost:3000, full pipeline in-process
```

Open http://localhost:3000 and press **Run the Winning Moment**. Executions A and B replay Ring-shaped source events through the real pipeline (normalizer, evidence resolver, Sequence Integrity Engine, Action Policy Engine, Operational Gate, receipt generator). Nothing is hard-coded: every verdict on screen is computed.

Without a browser:

```bash
pnpm demo:headless             # A → SEALED → RELEASE, B → ORDER-02 FAIL → DEVIATED → HOLD
pnpm replay --scenario ambiguous-evidence
pnpm benchmark                 # 31 scenarios + safety metrics → benchmarks/results/latest.md
```

## What is in the box

```
packages/
  pwps/                 @pwps/core — PWPS 0.1 spec, JSON Schema, parser, validator, canonical hash,
                        compiler, reference evaluator, CLI, conformance suite (Apache-2.0)
  contracts/            shared zod schemas, enums, domain events, versions
  engine-core/          Sequence Integrity Engine: V = f(P, E), deterministic, explainable
  action-policy-core/   Action Policy Engine: A = g(V, Π), safe-MVP invariants (only SEALED may RELEASE)
  evidence-model/       source bindings, deterministic mappings, acceptance policy, AI interpreter boundary
  ring-adapter/         webhook HMAC + JSON:API envelope, normalization, Playground captures, API client
  pipeline/             event-driven orchestration, Operational Gate, receipts, replay, read model
  aws/                  DynamoDB, EventBridge, S3, Secrets Manager, Bedrock, EMF metrics, Lambda glue
services/               13 Lambda entry points (one per pipeline stage)
apps/web/               judge-facing Next.js UI and local backend
protocols/              inbound-delivery.yaml (IDP-01@1.0.0)
policies/               action policy, evidence acceptance policy, examples
config/                 Ring source bindings and evidence mappings
fixtures/scenarios/     Ring-shaped replay scenarios (correct, wrong, missing, ambiguous)
benchmarks/             31-scenario benchmark harness and results
infrastructure/terraform/   AWS deployment (dev, demo)
docs/                   architecture, Ring integration, safety, evaluation, claims, demo script
```

## Commands

| Command | What it does |
|---|---|
| `pnpm demo` | Web UI with the in-process pipeline (`SEQSEAL_BACKEND=local`) |
| `pnpm test` | Unit, conformance, golden, end-to-end and benchmark-gate tests (Vitest) |
| `pnpm test:winning` | The Winning Moment acceptance test (A released, B held, 10 consecutive runs) |
| `pnpm benchmark --check` | Run the benchmark and fail on any safety-metric regression |
| `pnpm pwps validate <file>` | Validate a PWPS protocol (`inspect`, `hash`, `canonicalize`, `compile`, `eval` also available) |
| `pnpm replay --scenario <id>` | Replay a fixture scenario headlessly (or against a deployment with `--remote`) |
| `pnpm sign-webhook --url … --secret …` | Send a correctly signed Ring-shaped webhook to a SEQSEAL endpoint |
| `pnpm build:lambdas` | Bundle the 13 Lambda functions to `services/<name>/dist/<name>.zip` |
| `pnpm hcl:check` | Parse every Terraform file |
| `pnpm ci` | Lint, typecheck, tests, benchmark gate, protocol validation |

## Deploy to AWS

```bash
pnpm build:lambdas
cd infrastructure/terraform/environments/demo
terraform init && terraform apply
```

Then put the Ring webhook signing key, the Ring API token and a demo token into the Secrets Manager containers named in `terraform output`, register `webhook_url` with Ring, and point the web app at the API:

```bash
SEQSEAL_BACKEND=remote SEQSEAL_API_URL=<api_endpoint> SEQSEAL_DEMO_TOKEN=<token> pnpm --filter @seqseal/web build
```

Step-by-step instructions, IAM authority table and alarms: [infrastructure/terraform/README.md](infrastructure/terraform/README.md).

## Guarantees this implementation enforces

- **Absence is never failure.** Missing evidence yields INCOMPLETE → WAIT, never DEVIATED.
- **Only SEALED may RELEASE**, and RELEASE is never applied provisionally. A policy that maps anything else to RELEASE fails validation and blocks startup.
- **The engine is a pure function.** Same protocol hash, same evidence set hash and same engine version give the same verdict; every receipt can be replayed.
- **AI is confined to evidence.** The interpreter's output schema has no verdict or action field; on AWS, the verdict, policy, gate and receipt roles have an explicit `Deny bedrock:*`.
- **Physical time, not delivery time.** Evidence is ordered by when it happened, so late or reordered webhooks do not change the verdict.
- **Duplicates are harmless.** Ring deliveries, evidence admission and operational actions are idempotent.
- **Errors are not verdicts.** Engine or gate failures are recorded as system errors and never release a workflow.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, events, data model, AWS mapping
- [docs/RING_INTEGRATION.md](docs/RING_INTEGRATION.md) — webhook, Playground, source profiles, bindings
- [docs/ring-playground-observations.md](docs/ring-playground-observations.md) — what to record from the live Ring spike
- [docs/EVALUATION.md](docs/EVALUATION.md) — benchmark design and results
- [docs/SAFETY.md](docs/SAFETY.md) · [docs/PRIVACY.md](docs/PRIVACY.md)
- [docs/CLAIMS.md](docs/CLAIMS.md) — what SEQSEAL does and does not claim
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) — three-minute walkthrough
- [docs/BUILD_NOTES.md](docs/BUILD_NOTES.md) · [docs/FRICTION_LOG.md](docs/FRICTION_LOG.md)
- [packages/pwps/SPEC.md](packages/pwps/SPEC.md) — PWPS 0.1 specification

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Ring is a trademark of Ring LLC; SEQSEAL is not affiliated with or endorsed by Ring or Amazon.
