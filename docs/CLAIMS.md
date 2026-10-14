# Claims ledger

Every statement SEQSEAL makes in its README, demo or submission must appear here with the evidence behind it.

- **Commit.** Benchmark numbers are tied to the commit recorded at the top of `benchmarks/results/latest.md`. Re-run `pnpm benchmark --check` and tag `evaluation-freeze` before publishing them.
- **Safe wording.** If a claim is not in this table, do not make it.

## 1. Claims

| Claim | Evidence | Where measured | Safe wording |
|---|---|---|---|
| Same events, different order, different action | `tests/winning-moment.spec.ts`, benchmark B01/B02 | Vitest, `pnpm benchmark` | "Two executions with the same Ring-shaped events, protocol, policy and engine version differ only in order. One is SEALED and released; the other fails ORDER-02 and is held." |
| No unsupported benchmark scenario was released | `benchmarks/results/latest.md` | `pnpm benchmark` | "0 false RELEASE across the 21 unsupported scenarios of our 31-scenario benchmark." |
| No unsupported scenario was sealed | same | same | "0 false SEALED across 21 unsupported benchmark scenarios." |
| Expected verdicts on the benchmark | same | same | "On our defined benchmark, every scenario produced the expected verdict and action." |
| Receipts replay | same; `replayReceipt` | same | "All 31 benchmark receipts replayed to the same verdict, action and hashes." |
| Provenance | same | same | "Every evidence item in the benchmark traces to an observation and a raw source event (140/140)." |
| Determinism | same, determinism block | 100× A and 100× B with shuffled input order | "The engine returned identical results across 200 shuffled-order evaluations." |
| Only SEALED may release | `packages/action-policy-core`, B14 | unit tests, benchmark | "The safe policy profile refuses any mapping other than SEALED → RELEASE and never releases provisionally." |
| AI cannot seal or release | interpreter schema, forced tool use, IAM `Deny bedrock:*` (`infrastructure/terraform/modules/iam`), B12/B13/B13b | unit tests, benchmark, Terraform source | "AI can propose evidence. It cannot produce a verdict or an action; the decision path has no Bedrock permission." |
| Ring webhook authenticity | `packages/ring-adapter/src/signature.ts`, B11/B11b | unit tests, benchmark | "Ring webhooks are verified with HMAC-SHA256 over the raw body; unsigned or wrongly signed deliveries create nothing." |
| PWPS is open source and independently usable | `packages/pwps` (Apache-2.0), conformance suite | `pnpm test` | "PWPS 0.1 ships with a JSON Schema, validator, canonical hash, CLI, examples and a conformance suite." |
| AWS architecture | `infrastructure/terraform`, `services/*`, `pnpm hcl:check`, `pnpm build:lambdas` | static checks and bundle build | "SEQSEAL ships an event-driven AWS deployment (Lambda, EventBridge, SQS, DynamoDB, S3, Secrets Manager, optional Bedrock) as Terraform." Say "deployed" only after an actual `terraform apply`. |

## 2. Implemented, not yet demonstrated live

| Item | Status | What is needed before claiming it |
|---|---|---|
| Live Ring Developer Playground captures | adapter, capture endpoint and spike script implemented and tested with fixtures | run `scripts/ring-spike.ts` with a Playground token; fill [ring-playground-observations.md](ring-playground-observations.md) |
| Ring production webhooks | endpoint, HMAC, envelope parsing implemented | a registered Ring app delivering to `webhook_url` |
| AWS deployment | Terraform, bundles and handlers implemented; HCL parsed, bundles invoked locally | `terraform apply` in an AWS account, then an end-to-end run |
| Bedrock evidence interpretation | Converse with forced tool use implemented behind `ENABLE_BEDROCK_EVIDENCE` | an enabled model and a measured run; the benchmark uses a deterministic mock |

Until those steps are done, the demo source label reads **Test fixture (Ring-shaped replay)**. It must not be described as live Ring data.

## 3. Not implemented (do not mention as features)

- AgentCore orchestration.
- Reconciliation jobs.
- Push updates (the UI polls).
- Multi-camera fusion beyond one binding per zone.
- Multiple concurrent deliveries per lane.
- Any form of person identification.

## 4. Never claim

- zero risk;
- no hallucinations;
- tamper-proof receipts;
- legal certification or non-repudiation (receipts are hash-linked application artifacts, not signatures);
- production safety for all workflows;
- universal process compliance;
- elimination of human error;
- real-world accuracy;
- latency figures (not measured);
- "first camera workflow system".

Positioning that is safe to use: *SEQSEAL explores Ring as an evidence layer for protocol-bound physical workflow integrity, moving beyond isolated events toward explainable multi-step verification and operational gating.*
