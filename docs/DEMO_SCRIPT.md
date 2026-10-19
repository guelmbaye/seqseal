# Demo script

The video opens with the Obvious Magic: a checklist where every box is checked and Release is still locked. It does not open with architecture, the receipt or the protocol (Master Brief §53). Every screen shown is the running application, and nothing on screen is staged.

## Before recording

```bash
pnpm install
pnpm build && pnpm --filter @seqseal/web start      # or `pnpm demo`
```

1. Open http://localhost:3000 and press **Clear results**.
2. Dry run: press **Run deliveries A and B again** 10 times in a row. Each run must end with Delivery A **Unlocked** and Delivery B **Locked: Wrong order**. Do not restart services, edit the database or run corrective scripts. `pnpm test:winning` also runs 100 × A and 100 × B.
3. Choose the source level. Its label is always on screen:

   | Level | What runs | Label shown |
   |---|---|---|
   | 1 (preferred) | Live Ring Developer Playground captures (`scripts/ring-spike.ts capture … --post http://localhost:3000`) | Ring Developer Playground |
   | 2 | A saved Playground session replayed through the normal pipeline (Monitor, or `pnpm replay --captures …`). The repository ships the live run of 2026-10-19: `live-2026-10-19-a` and `live-2026-10-19-b` | Ring-derived replay |
   | 3 | Test fixtures through the normal pipeline (what the repository ships) | Test fixture (Ring-shaped replay) |

   Never call level 2 or level 3 "live". Never say "real device" for Playground sources.
4. Freeze the claims: run `pnpm benchmark --check`, tag `evaluation-freeze`, then tag `demo-final`. Record against `demo-final`.

### Live Playground session (level 1)

Generate a Playground token first, before clicking any simulation. A token lasts about 30 minutes, and one delivery takes about 5: generate a new one if fewer than 12 minutes are left. Then run one command per delivery:

```bash
pnpm tsx scripts/ring-spike.ts run --device <id> --post http://localhost:3000 --delivery A
pnpm tsx scripts/ring-spike.ts run --device <id> --post http://localhost:3000 --delivery B
```

For each step, the command prints which simulation to click ("Step 2 of 5, Staging: click PACKAGE in the Playground now"). Click it once. The command then:

- waits for the Ring history event (Package and Motion clips last about 22 s, Vehicle about 40 s);
- sends the capture to SEQSEAL;
- moves to the next step.

At the end it prints SEQSEAL's verdict and action, for example "SEALED -> RELEASE, workflow RELEASED".

What the command guarantees:

- **Order and steps.** The steps come from the protocol and the mappings: A follows the expected sequence, and B swaps the two states of the signature rule.
- **Ring events only.** Every step is bound to a Ring history event; nothing falls back to a status probe. Only an event that started after the step was shown counts, so a test simulation played just before cannot become the Arrival.
- **Deadlines.** It prints the time limits that apply, for example "Staging must start before 14:07:00 UTC (TEMP-01: within 7 min of Arrival)".
- **One delivery at a time.** It refuses to start B while A is still open.
- **Resuming.** If no event arrives after three waits, or the token expires, it stops without sending anything for that step. Run the same command again (with a new token if needed) and it resumes where it stopped.

Single steps can still be captured with `capture --source … --zone … --session … --require-event`, which applies the same lane checks. If no event appears, run `pnpm tsx scripts/ring-spike.ts history --device <id>` right after a simulation to see what Ring lists.

| Step | Simulation | `--zone` | Delivery A | Delivery B |
|---|---|---|---|---|
| Arrival | VEHICLE | receiving-entry | 1st | 1st |
| Staging | PACKAGE | staging | 2nd | **3rd** |
| Storage | MOTION | storage-transition | 3rd | **2nd** |
| Departure | VEHICLE | receiving-exit | 4th | 4th |
| Clear | MOTION | receiving-exit | 5th | 5th |

- **Time limit:** stay within 7 minutes between Arrival and Staging (TEMP-01).
- **Hero screen:** the checklist follows the session. Delivery A fills in, then Delivery B appears next to it.
- **Fallback:** every capture is saved to `fixtures/ring/captures/<session>.jsonl`, which becomes the level 2 replay.
- **Start over:** press **Clear results** (or restart `pnpm demo`), delete the session file (`fixtures/ring/captures/demo-a.jsonl` or `demo-b.jsonl`), and run the delivery again. Old Ring events are never reused.

## 0:00–0:12: the Obvious Magic (works muted)

Press **Play the 12-second walkthrough** on the checklist screen. It plays these stages over the real results:

| Time | Screen | Caption |
|---|---|---|
| 0–2 s | Delivery B, every box checked; Delivery A dimmed | "Every box is checked." then "So why is Release still locked?" (the locked button is outlined) |
| 2–5 s | Delivery B's Storage 14:03 and Staging 14:06 rows highlighted | "Wrong order: Storage 14:03, then Staging 14:06." |
| 5–8 s | Delivery A; Staging 14:03 and Storage 14:06 highlighted; the button pulses | "Right order: Staging 14:03, then Storage 14:06." then "Release unlocked." |
| 8–12 s | Both deliveries side by side | "Right order → Release. Wrong order → Hold." then "SEQSEAL. A checklist that can see." |

Opening narration: *"Every box is checked. So why is Release still locked? Because seeing every step doesn't prove the process happened in the right order."*

## 0:12–3:00: the full video

| Time | Segment | Screen | Narration |
|---|---|---|---|
| 0:12 | Winning Moment proof | Press **Release delivery** on B: ORDER-02 failed; expected STAGING before STORAGE; observed STORAGE 14:03, STAGING 14:06 | "Same observations. Different sequence. Different operational action." |
| 0:25 | Problem and Ring source | Card source label; **System** page; at level 1, one live capture landing in the checklist | "Cameras can prove every expected activity happened and still miss that the required process was not followed. Ring gives the checklist eyes: SEQSEAL turns Ring observations into workflow evidence." |
| 0:45 | Deterministic verification | **Open the full verification**: checklist, Why table, expected versus observed lanes, evidence graph; open STORAGE in the evidence drawer down to the Ring event | "The expected process is declared in PWPS. The engine compares the observed sequence with it deterministically: no model decides." |
| 1:15 | Operational Gate | Operational gate panel: DEVIATED, then IDP-ACTION@1.0.0, then HOLD; workflow PENDING → HELD by `WorkflowHeld` | "Verdict and action are separate. A versioned policy maps SEALED to RELEASE and DEVIATED to HOLD. WorkflowHeld is a real event, not a label." |
| 1:35 | Bedrock and uncertainty | Monitor: **Run ambiguous evidence**, then open that execution: Staging shows a "?" box and the button says Locked, "Needs review". Press **Confirm evidence**: the engine re-evaluates, the button unlocks and receipt v2 is issued | "When Ring metadata is not enough, AI may propose evidence. It cannot release the workflow. A supervisor confirms the evidence; the engine, not the person, re-decides." |
| 1:55 | SeqSeal Receipt | **Receipts › SSR-0002**: Why this action chain; **Replay verification** says "Matches the original receipt." | "Every final decision produces a SeqSeal Receipt linking the action to the policy, the verdict, the failed rule and the Ring-derived evidence, and it can be replayed." |
| 2:15 | AWS | The diagram in [ARCHITECTURE.md](ARCHITECTURE.md) §4, CloudWatch dashboard if deployed | "On AWS, each stage is a Lambda behind EventBridge and SQS. Bedrock is a side branch, and the decision path has no permission to call it." |
| 2:35 | PWPS | Terminal: `pnpm pwps validate protocols/inbound-delivery.yaml` → `✓ PWPS 0.1 valid`; **Protocol** page | "And the protocol isn't hard-coded. It is written in PWPS, our open-source Physical Workflow Protocol Specification." |
| 2:50 | Close | The checklist with A unlocked and B locked | "Ring observes. SEQSEAL verifies whether the workflow can proceed. A checklist that can see." |

## Submission story

> Every box can be checked and the physical process can still be wrong. SEQSEAL gives a receiving checklist eyes. Ring observes what actually happened. SEQSEAL verifies whether those steps occurred in the required order. Release only unlocks when the workflow is supported by sufficient evidence.
>
> Same observations. Different sequence. Different operational action.

For technical judges:

> Ring provides physical observations. PWPS defines expected execution. SEQSEAL builds traceable evidence and evaluates the sequence deterministically. A separate versioned policy converts the resulting verdict into an operational action.

## What the judge should remember

1. Every box is checked. Release is still locked.
2. Ring gives the checklist eyes.
3. AI can propose evidence. It cannot release the workflow.
4. Same observations. Different sequence. Different operational action.

## Questions judges ask

| Question | Answer and where to show it |
|---|---|
| Is that actually Ring? | Read the source label on each card. Name the level honestly (Playground, Ring-derived replay or test fixture). The evidence drawer shows the Ring event id. |
| Which protocol, which policy? | **Protocol** page; every receipt shows both, with their hashes. |
| What if a camera is offline? | The verdict is UNCERTAIN → REVIEW, never HOLD and never RELEASE (benchmark B08). |
| Can a reviewer just release it? | No. Reviewers confirm or reject evidence, and the engine re-evaluates (B23, B24). |
| What does HOLD do? | It stops the receiving workflow from proceeding automatically. It does not lock doors or stop machinery. |
| Biggest limitation? | One active delivery per lane; multi-delivery correlation is future work (BUILD_NOTES BN-015). |
| What is open source? | `packages/pwps`: spec, schema, parser, validator, canonicalizer, hash, compiler, CLI, examples and conformance tests (Apache-2.0). |
