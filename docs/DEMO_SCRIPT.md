# Demo script

The video opens with the Obvious Magic: a checklist where every box is checked and Release is still locked. It does not open with architecture, the receipt or the protocol (Master Brief §53). Every screen shown is the running application, and nothing on screen is staged.

What has actually been run, and what this script relies on:

| Date (UTC) | What | Result |
|---|---|---|
| 2026-10-19 14:46–14:55 | Live run through the Ring Developer Playground: `ring-spike.ts run --delivery A`, then `--delivery B`. Every step is a Ring history event | A: SEALED → RELEASE<br>B: DEVIATED → HOLD (ORDER-02, Storage 54 s before Staging) |
| 2026-10-19 15:05 | The two saved sessions, `live-2026-10-19-a` and `-b`, replayed from the Monitor page and with `pnpm replay --captures` | same results, labelled Ring-derived replay. `tests/ring-live-sessions.spec.ts` pins them |
| every commit | test fixtures (**Run deliveries A and B again**), `pnpm test:winning` (100 × A, 100 × B) and the benchmark | A released, B held |

## Before recording

```bash
pnpm install
pnpm build && pnpm --filter @seqseal/web start      # or `pnpm demo`
```

1. Open http://localhost:3000 and press **Clear results**.
2. Dry run: press **Run deliveries A and B again** 10 times in a row. Each run must end with Delivery A **Unlocked** and Delivery B **Locked: Wrong order**. Do not restart services, edit the database or run corrective scripts. `pnpm test:winning` also runs 100 × A and 100 × B. Then press **Clear results** again.
3. Choose the source level. Its label is always on screen, top right and on the checklist:

   | Level | What runs | Label shown |
   |---|---|---|
   | 1 (preferred) | A live run through the Ring Developer Playground, just before recording (below). Every step is a Ring history event | Ring Developer Playground |
   | 2 | The live run of 2026-10-19, replayed from the Monitor page | Ring-derived replay |
   | 3 | Test fixtures (**Run deliveries A and B again**) | Test fixture (Ring-shaped replay) |

   Rules for the labels:
   - Never call level 2 or level 3 "live".
   - Never say "real device" or "real camera" for Playground sources.
   - Never say Ring "detected" a vehicle, a package or motion: Ring's Playground events carry no class (FRICTION_LOG FL-006).
4. Keep one level on screen. After a level 1 or level 2 run, do not press **Run deliveries A and B again**: it replaces the checklist with test fixtures.
5. Freeze the claims: run `pnpm benchmark --check`, tag `evaluation-freeze`, then tag `demo-final`. Record against `demo-final`.

### Level 1: live run through the Ring Developer Playground

Prepare:

- **SEQSEAL.** Run `pnpm demo` in one terminal, then open http://localhost:3000 and press **Clear results**.
- **Playground.** Open the Ring Developer Playground in the browser and generate a token. It lasts about 30 minutes, and the two deliveries took 9 minutes on 2026-10-19.
- **Terminal.** In a second terminal, set the token and the Playground device id. The token is never written to disk:

  ```powershell
  $env:RING_PLAYGROUND_TOKEN = "<token>"
  $D = "<Playground device id>"
  ```

  On bash: `export RING_PLAYGROUND_TOKEN=…` and `D=…`.
- **Screen recording.** Start a screen recording of the terminal, the Playground and the checklist. Segment 0:25 uses 10–15 s of it.

Run one command per delivery:

```powershell
pnpm tsx scripts\ring-spike.ts run --device $D --post http://localhost:3000 --delivery A
pnpm tsx scripts\ring-spike.ts run --device $D --post http://localhost:3000 --delivery B
```

For each step, the command prints which simulation to click, for example "Step 2 of 5, Staging: click PACKAGE in the Playground now". Click it once in the Playground. The command then:

- **waits for the Ring event.** Ring lists the event at the end of the clip. Clip lengths are Vehicle about 22 s, Package about 32 s, and Motion about 40 s, so each step takes about 30–45 s;
- **sends the capture** to SEQSEAL;
- **moves to the next step.**

At the end, it prints SEQSEAL's result. The real output of 2026-10-19:

```text
Delivery A (EXEC-0001): SEALED -> RELEASE, workflow RELEASED.
  All mandatory protocol constraints are satisfied by accepted evidence.
Delivery B (EXEC-0002): DEVIATED -> HOLD, workflow HELD.
  STORAGE occurred 54 s before required STAGING. (ORDER-02)
```

What the command guarantees:

- **Order and steps.** The steps come from the protocol and the mappings: A follows the expected sequence, and B swaps the two states of the signature rule.
- **Ring events only.** Every step is bound to a Ring history event; nothing falls back to a status probe. Only an event that started after the step was shown counts, so a test simulation played just before cannot become the Arrival.
- **Deadlines.** It prints the time limits that apply, for example "Staging must start before 14:53:08 UTC (TEMP-01: within 7 min of Arrival)".
- **One delivery at a time.** It refuses to start B while A is still open.
- **Resuming.** If no event arrives after three waits, or the token expires, it stops without sending anything for that step. Run the same command again (with a new token if needed) and it resumes where it stopped.
- **Network errors.** A dropped connection on one poll prints "network error … asking again"; the next poll retries. It happened twice on 2026-10-19, and no step was lost.

| Step | Simulation | Zone | Delivery A | Delivery B |
|---|---|---|---|---|
| Arrival | VEHICLE | receiving-entry | 1st | 1st |
| Staging | PACKAGE | staging | 2nd | **3rd** |
| Storage | MOTION | storage-transition | 3rd | **2nd** |
| Departure | VEHICLE | receiving-exit | 4th | 4th |
| Clear | MOTION | receiving-exit | 5th | 5th |

- **Checklist.** The home page follows the run: Delivery A fills in, then Delivery B appears next to it.
- **Session files.** Captures are saved to `fixtures/ring/captures/demo-a.jsonl` and `demo-b.jsonl`. Do not reuse the names `live-2026-10-19-*`, which hold the reference run.
- **Starting over.** Press **Clear results**, delete `demo-a.jsonl` and `demo-b.jsonl`, and run again. Old Ring events are never reused.
- **Single steps.** `capture --source … --zone … --session … --require-event` captures one step with the same checks. If no event appears, run `pnpm tsx scripts\ring-spike.ts history --device $D` right after a simulation to see what Ring lists.

### Level 2: the live run of 2026-10-19, replayed

1. On the **Monitor** page, press **Replay Ring-derived session live-2026-10-19-a (5 captures)**.
2. When it has finished, press **Replay Ring-derived session live-2026-10-19-b (5 captures)**.
3. The checklist shows "Source: Ring-derived replay":
   - Delivery A is **Unlocked**, with Staging 14:46 and Storage 14:47.
   - Delivery B is **Locked: Wrong order**, with Storage 14:51 and Staging 14:52.

The same replay runs from a terminal with `pnpm replay --captures fixtures/ring/captures/live-2026-10-19-a.jsonl` (then `-b`).

### Shooting order

**Run ambiguous evidence** (segment 1:35) is a test fixture and becomes the newest delivery. When A and B come from Ring (levels 1 and 2), the home page then shows that delivery alone instead of A and B, even after **Confirm evidence**. This was checked on 2026-10-19. So shoot the segments in this order, then edit them in timeline order:

1. 0:00, 0:12, 0:25, 0:45, 1:15, 1:55 and 2:50: everything that shows Deliveries A and B.
2. 2:15 and 2:35: documentation and terminal, at any time.
3. 1:35 last.

At level 3 the order does not matter, because all deliveries are test fixtures.

## 0:00–0:12: the Obvious Magic (works muted)

Press **Play the 12-second walkthrough** on the checklist screen. It plays these stages over the deliveries on screen, and its captions use their own times:

| Time | Screen | Caption (times from the 2026-10-19 run; test fixtures show 14:03 and 14:06) |
|---|---|---|
| 0–2 s | Delivery B, every box checked; Delivery A dimmed | "Every box is checked." then "So why is Release still locked?" (the locked button is outlined) |
| 2–5 s | Delivery B's Storage and Staging rows highlighted | "Wrong order: Storage 14:51, then Staging 14:52." |
| 5–8 s | Delivery A; Staging and Storage highlighted; the button pulses | "Right order: Staging 14:46, then Storage 14:47." then "Release unlocked." |
| 8–12 s | Both deliveries side by side | "Right order → Release. Wrong order → Hold." then "SEQSEAL. A checklist that can see." |

Opening narration: *"Every box is checked. So why is Release still locked? Because seeing every step doesn't prove the process happened in the right order."*

## 0:12–3:00: the full video

| Time | Segment | Screen | Narration |
|---|---|---|---|
| 0:12 | Winning Moment proof | Press **Release delivery** on B: ORDER-02 failed, expected STAGING before STORAGE, observed STORAGE then STAGING. In the 2026-10-19 run they were at 14:51:16 and 14:52:10, 54 s apart | "Same observations. Different sequence. Different operational action." |
| 0:25 | Problem and Ring source | The source label on the cards. At level 1, add 10–15 s from the screen recording of the live run: the terminal saying "click PACKAGE in the Playground now", the clip playing, the Staging box checking. Keep its clock visible, and mark it if it is sped up | "Cameras can prove every expected activity happened and still miss that the required process was not followed. Ring gives the checklist eyes. Here the footage is simulated by the Ring Developer Playground; Ring records each clip as an event, and every step is bound to one." |
| 0:45 | Deterministic verification | **Open the full verification**: checklist, Why table, expected versus observed lanes, evidence graph. Open STORAGE in the evidence drawer: "Ring proof: Ring history event (on_demand)", "Time from: Start of the Ring event", and the Ring event id and request id | "The expected process is declared in PWPS. The engine compares the observed sequence with it deterministically: no model decides. Every step leads back to a Ring event." |
| 1:15 | Operational Gate | Operational gate panel: DEVIATED, then IDP-ACTION@1.0.0, then HOLD; workflow PENDING → HELD by `WorkflowHeld` | "Verdict and action are separate. A versioned policy maps SEALED to RELEASE and DEVIATED to HOLD. WorkflowHeld is a real event, not a label." |
| 1:35 (shoot last) | Bedrock and uncertainty | Monitor: **Run ambiguous evidence**, then open that execution: Staging shows a "?" box and the button says Locked, "Needs review". Press **Confirm evidence**: the engine re-evaluates, the button unlocks and receipt v2 is issued. This delivery is a test fixture, and its card says so | "When Ring metadata is not enough, AI may propose evidence. It cannot release the workflow. A supervisor confirms the evidence; the engine, not the person, re-decides." |
| 1:55 | SeqSeal Receipt | **Receipts**, then Delivery B's receipt (SSR-0002 when A and B are the first runs after **Clear results**): the Why this action chain; **Replay verification** says "Matches the original receipt." | "Every final decision produces a SeqSeal Receipt linking the action to the policy, the verdict, the failed rule and the Ring evidence, and it can be replayed." |
| 2:15 | AWS | The diagram in [ARCHITECTURE.md](ARCHITECTURE.md) §4. Show the CloudWatch dashboard only after an actual `terraform apply` | "On AWS, each stage is a Lambda behind EventBridge and SQS. Bedrock is a side branch, and the decision path has no permission to call it." Say "deployed" only after `terraform apply`. |
| 2:35 | PWPS | Terminal: `pnpm pwps validate protocols/inbound-delivery.yaml` → `✓ PWPS 0.1 valid`; **Protocol** page | "And the protocol isn't hard-coded. It is written in PWPS, our open-source Physical Workflow Protocol Specification." |
| 2:50 (shoot before 1:35) | Close | The checklist with A unlocked and B locked | "Ring observes. SEQSEAL verifies whether the workflow can proceed. A checklist that can see." |

## Submission story

> Every box can be checked and the physical process can still be wrong. SEQSEAL gives a receiving checklist eyes. Ring observes what actually happened. SEQSEAL verifies whether those steps occurred in the required order. Release only unlocks when the workflow is supported by sufficient evidence.
>
> Same observations. Different sequence. Different operational action.

For technical judges:

> Ring provides physical observations. PWPS defines expected execution. SEQSEAL builds traceable evidence and evaluates the sequence deterministically. A separate versioned policy converts the resulting verdict into an operational action. Both deliveries ran live through the Ring Developer Playground, every step bound to a Ring history event: A was released, and B was held because Storage came 54 s before Staging.

## What the judge should remember

1. Every box is checked. Release is still locked.
2. Ring gives the checklist eyes.
3. AI can propose evidence. It cannot release the workflow.
4. Same observations. Different sequence. Different operational action.

## Questions judges ask

| Question | Answer and where to show it |
|---|---|
| Is that actually Ring? | Read the source label and name the level honestly: Playground, Ring-derived replay or test fixture. At levels 1 and 2, every step is a Ring history event: the evidence drawer shows the event id, the Ring request id, "Ring proof" and "Time from". The ids of the 2026-10-19 run are in [ring-playground-observations.md](ring-playground-observations.md) §7. |
| Does Ring say it was a vehicle? | No. Playground events are `on_demand`, with an empty `cv_detections`. The operator declares each step's source and zone, and the drawer says so (FRICTION_LOG FL-006). A production integration maps the Ring webhook's detection subtype through the configured mappings. |
| Which protocol, which policy? | **Protocol** page; every receipt shows both, with their hashes. |
| What if a camera is offline? | The verdict is UNCERTAIN → REVIEW, never HOLD and never RELEASE (benchmark B08). |
| Can a reviewer just release it? | No. Reviewers confirm or reject evidence, and the engine re-evaluates (B23, B24). |
| What does HOLD do? | It stops the receiving workflow from proceeding automatically. It does not lock doors or stop machinery. |
| Biggest limitation? | One active delivery per lane: multi-delivery correlation is future work (BUILD_NOTES BN-015). In the Playground, the source of each step is declared by the operator. |
| What is open source? | `packages/pwps`: spec, schema, parser, validator, canonicalizer, hash, compiler, CLI, examples and conformance tests (Apache-2.0). |
