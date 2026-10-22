# Claims ledger

Every statement SEQSEAL makes in its README, demo or submission must appear here with the evidence behind it.

- **Commit.** Benchmark numbers are tied to the commit recorded at the top of `benchmarks/results/latest.md`. Re-run `pnpm benchmark --check` and tag `evaluation-freeze` before publishing them.
- **Safe wording.** If a claim is not in this table, do not make it.

## 1. Claims

| Claim | Evidence | Where measured | Safe wording |
|---|---|---|---|
| Every box is checked, Release is still locked | the checklist screen; `lib/checklist.ts` derives rows from accepted evidence and the button from the applied `ReceivingWorkflow` state | UI on `pnpm demo`; `tests/pipeline.e2e.test.ts` (hero) | "Delivery B shows every receiving step checked, and Release delivery stays locked because ORDER-02 failed: Storage 14:03 came before Staging 14:06." |
| Live Ring Developer Playground deliveries | `ring-spike.ts run --delivery A` and `--delivery B`, 2026-10-19 14:46–14:55 UTC: ten steps, each bound to a Ring history event (ids, times and request ids in [ring-playground-observations.md](ring-playground-observations.md) §7) | SEQSEAL's own result: A SEALED → RELEASE, B DEVIATED → HOLD (ORDER-02) | "Delivery A and Delivery B ran live through the Ring Developer Playground. Every step is a Ring history event; A was released and B was held because Storage came 54 s before Staging." Say that the footage is simulated by the Playground, that the operator binds each Ring event to its simulation and dock zone because the Playground does not classify the footage, and that the operator never chooses the verdict or the action: both are computed from the Ring event timestamps. |
| Ring-derived replay of real Ring sessions | `fixtures/ring/captures/live-2026-10-19-a.jsonl` and `-b.jsonl` (the live run above), replayed through the normal pipeline | `pnpm replay --captures …`; `tests/ring-live-sessions.spec.ts`; Monitor page | "The live Ring sessions are saved and replay through the same pipeline to the same result: A released, B held on ORDER-02." Label: Ring-derived replay, never live. |
| Same events, different order, different action | `tests/winning-moment.spec.ts`, benchmark B01/B02 | Vitest, `pnpm benchmark` | "Two deliveries with the same Ring-shaped events, protocol, policy, mappings and engine version differ only in order. One is SEALED and released; the other fails ORDER-02 and is held." |
| No unsupported benchmark scenario was released | `benchmarks/results/latest.md` | `pnpm benchmark` | "0 false RELEASE across the 21 unsupported scenarios of our 32-scenario benchmark." |
| No unsupported scenario was sealed | same | same | "0 false SEALED across 21 unsupported benchmark scenarios." |
| Expected verdicts on the benchmark | same | same | "On our defined benchmark, every scenario produced the expected verdict and action." |
| Receipts replay | same; `replayReceipt` | same | "All 32 benchmark receipts replayed to the same verdict (replay consistency) and the same action (action replay consistency), with valid hashes." |
| The explanation chain needs no model | `packages/pipeline/src/explanation-chain.ts`, winning-moment spec | Vitest | "Every receipt explains its action deterministically: HOLD because DEVIATED → HOLD because ORDER-02 failed because STORAGE 14:03 occurred before STAGING 14:06." |
| Provenance | same | same | "Every evidence item in the benchmark traces to an observation and a raw source event (145/145)." |
| 100 × A / 100 × B | benchmark determinism block, winning-moment spec | `pnpm benchmark`, Vitest | "100/100 runs of A were SEALED and released; 100/100 runs of B were DEVIATED and held." |
| Determinism | same, determinism block | 100× A and 100× B with shuffled input order | "The engine returned identical results across 200 shuffled-order evaluations." |
| Only SEALED may release | `packages/action-policy-core`, B14 | unit tests, benchmark | "The safe policy profile refuses any mapping other than SEALED → RELEASE and never releases provisionally." |
| AI cannot seal or release | interpreter schema, forced tool use, IAM `Deny bedrock:*` (`infrastructure/terraform/modules/iam`), B12/B13/B13b | unit tests, benchmark, Terraform source | "AI can propose evidence. It cannot produce a verdict or an action; the decision path has no Bedrock permission." |
| Ring webhook authenticity | `packages/ring-adapter/src/signature.ts`, B11/B11b | unit tests, benchmark | "Ring webhooks are verified with HMAC-SHA256 over the raw body; unsigned or wrongly signed deliveries create nothing." |
| PWPS is open source and independently usable | `packages/pwps` (Apache-2.0), conformance suite | `pnpm test` | "PWPS 0.1 ships with a JSON Schema, validator, canonical hash, CLI, examples and a conformance suite." |
| AWS architecture | `infrastructure/terraform`, `services/*`, `pnpm hcl:check`, `pnpm build:lambdas` | static checks and bundle build | "SEQSEAL ships an event-driven AWS deployment (Lambda, EventBridge, SQS, DynamoDB, S3, Secrets Manager, optional Bedrock) as Terraform." For the deployment itself, see the next row. |
| SEQSEAL ran on AWS | `terraform apply` of the demo environment on 2026-10-21: 172 resources in us-east-1. Torn down on 2026-10-22 after the demo (`terraform destroy`, 172 resources), to stay within the AWS Free Tier; `terraform apply` recreates it. The live Ring sessions of 2026-10-19 replayed on AWS with `pnpm replay --remote` (Ring-derived replay). 09:29 UTC: A SEALED → RELEASE → RELEASED, B DEVIATED → HOLD → HELD. 09:52 UTC, after redeploying the BN-029 fix: A SEALED → RELEASE and B DEVIATED → HOLD again, one receipt each (SSR-0003, SSR-0004) | `infrastructure/terraform/README.md` §5: `/api/executions`, `/api/receipts` and the System page (**Backend** row "aws:demo"), read on 2026-10-21 and 2026-10-22 before the teardown | "SEQSEAL was deployed on AWS with Terraform: each stage is a Lambda behind EventBridge and SQS. The live Ring sessions, replayed on AWS, gave the same verdicts and actions as locally." In the video, filmed while it ran, "SEQSEAL runs on AWS" was true. Do not say it is running now. Bedrock is off on this deployment (`mock-evidence-interpreter@1`): never say Bedrock ran on AWS. |
| Live Ring Playground deliveries processed on AWS | 2026-10-21, two live runs: `ring-spike.ts run --delivery A`, then `--delivery B`, posting to the web console on the AWS backend, which forwards each capture to the deployed API. 16:19–16:28 UTC: EXEC-0005 (source RING_PLAYGROUND) SEALED → RELEASE → RELEASED, EXEC-0006 DEVIATED → HOLD → HELD. 17:05–17:13 UTC (the run filmed for the video): EXEC-0009 SEALED → RELEASE → RELEASED, EXEC-0010 DEVIATED → HOLD → HELD. Both B runs: ORDER-02, Storage 49 s before Staging. One receipt per delivery. Ring ids and request ids in [ring-playground-observations.md](ring-playground-observations.md) §8; sessions in `fixtures/ring/captures/live-2026-10-21-*.jsonl` | AWS read API `/api/executions` and `/api/hero` (source profiles, verdicts, actions, workflow states, receipts SSR-0005, SSR-0006, SSR-0009, SSR-0010); `tests/ring-live-sessions.spec.ts` replays the four sessions to the same results | "On October 21, both deliveries ran live through the Ring Developer Playground and were processed on the AWS deployment: A was released, B was held because Storage came 49 s before Staging." Same wording limits as the 2026-10-19 live run: simulated footage; the operator binds each event to its simulation and zone, never chooses the verdict or the action. |

## 2. Implemented, not yet demonstrated live

| Item | Status | What is needed before claiming it |
|---|---|---|
| Ring production webhooks | endpoint, HMAC, envelope parsing implemented | a registered Ring app delivering to `webhook_url` |
| Bedrock evidence interpretation | Converse with forced tool use implemented behind `ENABLE_BEDROCK_EVIDENCE` | an enabled model and a measured run; the benchmark uses a deterministic mock |

The shipped demo (**Run deliveries A and B again**) still uses test fixtures, labelled **Test fixture (Ring-shaped replay)**: it must not be described as live Ring data. Live Playground captures carry the **Ring Developer Playground** label.

Source wording (honesty lock):

- "Ring Developer Playground" only for live captures.
- "Ring-derived replay" only for saved Ring captures.
- "Test fixture" for the shipped fixtures.
- Never "real device" or "real camera" when the source is the Playground.

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
- that HOLD physically stops anything (it blocks the application-level receiving workflow only);
- "first camera workflow system";
- that Ring detected or classified a vehicle, a package or motion in Playground sessions. Ring's history events carry no class (`cv_detections` is empty, `event_type` is `on_demand`), so the source and zone of each Playground step are declared by the operator (FRICTION_LOG FL-006).

Product boundaries: SEQSEAL is not a WMS, ERP, generic video analytics, employee surveillance, a biometric system, an access-control controller, a universal SOP engine, process mining or an AI agent platform.

Positioning that is safe to use: *SEQSEAL explores Ring as an evidence layer for protocol-bound physical workflow integrity, moving beyond isolated events toward explainable multi-step verification and operational gating.*
