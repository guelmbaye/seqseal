# Demo script

A three-minute walkthrough, and a 25-second cut that stands on its own. Every screen shown is the running application; nothing on screen is staged.

## Before recording

```bash
pnpm install
pnpm build && pnpm --filter @seqseal/web start      # or `pnpm demo` for the dev server
```

1. Open http://localhost:3000 and press **Reset demo**.
2. Set `SEQSEAL_DEMO_PACE_MS=700` (the default) so that steps land visibly one after another.
3. Dry run: press **Run the Winning Moment** 10 times in a row. Every run must end with A RELEASED and B HELD, with no restarts and no manual edits.
4. Decide the source level and keep its label on screen:
   - **Level 1**: live Ring Developer Playground captures (`scripts/ring-spike.ts capture … --post http://localhost:3000`). Label: *Ring Developer Playground*.
   - **Level 2**: replay of captured Ring-originated events. Label: *Ring-derived replay*.
   - **Level 3**: test fixtures through the normal pipeline. Label: *Test fixture (Ring-shaped replay)*. This is what the repository ships.

   Never call Level 2 or Level 3 "live".
5. Tag the commit you record against: `git tag demo-final`.

## 0:00–0:25 — The Winning Moment (works muted)

| Time | Screen | Narration |
|---|---|---|
| 0:00 | Home: headline and the required sequence ARRIVAL › STAGING › STORAGE › DEPARTURE › CLEAR | "These two deliveries contain the same events. Only one should be released." |
| 0:03 | Press **Run the Winning Moment**. Execution A fills its observed lane in order, then shows SEALED ↓ policy ↓ **RELEASED**. Source chip visible. | — |
| 0:08 | Execution B fills: STORAGE lands before STAGING, the connectors cross in amber, **ORDER-02 failed**, DEVIATED ↓ policy ↓ **HOLD** in hazard tape | — |
| 0:14 | Point at B's rule callout: "STORAGE occurred 3 min before required STAGING", times 14:03 and 14:06 under the lanes | — |
| 0:20 | Closing line under the panels: "Same observations. Different sequence. Different operational action." | "Ring observes. SEQSEAL verifies the sequence and gates what the workflow may do next." |

## 0:25–3:00 — Full walkthrough

| Time | Segment | Screen | Narration |
|---|---|---|---|
| 0:25 | Problem | Home, A and B side by side | "Cameras can prove every expected activity happened and still fail to prove the required process was followed. In receiving, order decides whether goods may move on." |
| 0:42 | Ring source | **System**: Source chip, last observation, profiles seen. Optional Level 1: run one `ring-spike.ts capture` and show the observation appear. | "Ring provides the physical observations. SEQSEAL converts them into workflow evidence through explicit bindings." |
| 1:05 | Evidence → protocol → verdict | **Executions › EXEC-0002**: expected vs observed lanes; **Why** table with ORDER-02 FAIL and the counterfactual; click STORAGE to open the evidence drawer (Ring event → observation → evidence → rule) | "The expected process is declared. The engine compares the observed sequence deterministically and shows exactly which rule failed, and what would have passed." |
| 1:35 | Operational Gate | The same page, **Operational gate** panel: input verdict DEVIATED, policy IDP-ACTION 1.0.0, mapping, output HOLD; history PENDING → WAITING → HELD (`WorkflowHeld`) | "Verdict and action are separate. A versioned policy maps SEALED to RELEASE and DEVIATED to HOLD. The receiving workflow receives a WorkflowHeld event." |
| 1:55 | Uncertainty and the AI boundary | **Monitor › Run ambiguous evidence**, open the execution: STAGING? dashed, AI_ASSISTED, AMBIGUOUS LOW, verdict UNCERTAIN → REVIEW. Press **Confirm evidence**: re-evaluated, SEALED → RELEASED, receipt v2. | "When Ring metadata is not enough, AI may propose evidence. It cannot release anything. Here a supervisor confirms the evidence, and the engine, not the person, re-decides." |
| 2:12 | Receipt | **Receipts › SSR-0002**: action, verdict, rule results, provenance, hashes. Press **Replay verification**: "Matches the original receipt." | "Every final decision produces a SeqSeal Receipt, linked to the protocol, the policy, the failed rule and the Ring-derived evidence, and it can be replayed." |
| 2:28 | AWS | Architecture diagram from [ARCHITECTURE.md](ARCHITECTURE.md) §4 | "On AWS, each stage is a Lambda behind EventBridge and SQS, with state in DynamoDB and receipts in S3. Bedrock is a side branch, and the decision path has no permission to call it." |
| 2:42 | PWPS | Terminal: `pnpm pwps validate protocols/inbound-delivery.yaml` → `✓ PWPS 0.1 valid`, then the **Protocol** page | "The protocol isn't hard-coded. It is written in PWPS, our open-source Physical Workflow Protocol Specification." |
| 2:53 | Close | Home with A RELEASED and B HELD | "Ring observes. SEQSEAL verifies whether the workflow can proceed." |

## Questions judges ask

| Question | Where to answer |
|---|---|
| Is that actually Ring? | **System** page source label; drawer shows the Ring event id and profile. State the level honestly. |
| Which protocol, which policy? | Top of **Protocol** page; every receipt shows both with hashes. |
| What if a camera is offline? | B08: coverage gap → UNCERTAIN → REVIEW, never HOLD. |
| Can a reviewer just release it? | No. Reviewers confirm or reject evidence; the engine re-evaluates (B23, B24). |
| Biggest limitation? | One active execution per lane; multi-delivery correlation is open (BUILD_NOTES BN-015). |
| What is open source? | `packages/pwps`: spec, schema, validator, canonical hash, CLI, examples, conformance (Apache-2.0). |
