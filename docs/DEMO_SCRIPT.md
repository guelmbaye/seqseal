# Demo script

This is the shooting script for the 3-minute video. For each shot, it says what to open and click, what must be visible on screen, and the exact words to say.

The video opens with the Obvious Magic: a checklist where every box is checked and Release is still locked. It does not open with architecture, the receipt or the protocol (Master Brief §53). Every screen is the running application, and nothing on screen is staged.

What has actually been run, and what this script relies on:

| Date (UTC) | What | Result |
|---|---|---|
| 2026-10-19 14:46–14:55 | Live run through the Ring Developer Playground (`ring-spike.ts run --delivery A`, then `--delivery B`). Every step is a Ring history event | A: SEALED → RELEASE<br>B: DEVIATED → HOLD (ORDER-02, Storage 54 s before Staging) |
| 2026-10-19 15:05 | The two saved sessions `live-2026-10-19-a` and `-b`, replayed from the Monitor page and with `pnpm replay --captures` | same results, labelled Ring-derived replay; `tests/ring-live-sessions.spec.ts` pins them |
| 2026-10-20 | Every screen of this script, captured from the production build with those two sessions (the frames in `docs/demo/`) | labels and texts quoted below |
| 2026-10-21 09:29 and 09:52 | The same two sessions replayed on AWS (Terraform deployment, us-east-1) with `pnpm replay --remote` | same results on AWS: A SEALED → RELEASE → RELEASED, B DEVIATED → HOLD → HELD; after the BN-029 fix, one receipt per delivery |
| 2026-10-21 16:19–16:28 | Live run through the Ring Developer Playground, with the console on the AWS backend: every capture processed on the AWS deployment | EXEC-0005: SEALED → RELEASE → RELEASED<br>EXEC-0006: DEVIATED → HOLD → HELD (ORDER-02, Storage 49 s before Staging) |
| every commit | Test fixtures (**Run deliveries A and B again**), `pnpm test:winning` (100 × A, 100 × B) and the benchmark | A released, B held |

## 1. The video at a glance

| Shot | Time | Length | On screen | Say (summary) |
|---|---|---|---|---|
| S1 | 0:00 | 12 s | Checklist page, the 12-second walkthrough | Every box is checked; why is Release locked? |
| S2 | 0:12 | 15 s | Delivery B: **Release delivery** opened, ORDER-02 failed | Same steps, wrong order, Release locked |
| S3 | 0:27 | 18 s | The live run: terminal, Ring Developer Playground, a box checking | Ring gives the checklist eyes |
| S4 | 0:45 | 26 s | Verification page, then the STORAGE evidence drawer | Deterministic engine; every step leads to a Ring event |
| S5 | 1:11 | 18 s | Monitor: DEVIATED → policy → HOLD → WorkflowHeld | Verdict and action are separate |
| S6 | 1:29 | 18 s | Receipt SSR-0002, **Replay verification** | Receipt, replayable |
| S7 | 1:47 | 23 s | Ambiguous evidence: Needs review, **Confirm evidence**, Unlocked | AI can propose evidence; it cannot release |
| S8 | 2:10 | 15 s | AWS architecture, Terraform, the deployed Lambdas | Runs on AWS, no Bedrock in the decision path |
| S9 | 2:25 | 12 s | `pnpm pwps validate`, Protocol page | PWPS, open source |
| S10 | 2:37 | 8 s | Checklist: A unlocked, B locked | A checklist that can see |

Total: 2:45. The rules require a public video on YouTube or Vimeo, in English and **under 3 minutes**: the 15 s margin covers a title or end card. The narration is about 350 words, read at about 130 words per minute.

The frames in `docs/demo/` come from the level 2 replay (label "Ring-derived replay"). At level 1 the label reads "Ring Developer Playground", and the times are those of your own run.

## 2. Prepare

### 2.1 Screen and tools

- **Screen recorder.** Use OBS Studio (or any screen recorder) at 1920 × 1080, 30 fps. Record the screen without sound, and record the narration afterwards from section 5. A free editor is enough (Clipchamp on Windows, DaVinci Resolve).
- **Browser.**
  - Use a separate window, full screen (F11), at 125 % zoom.
  - Hide the bookmarks bar, close every other tab, and turn notifications off.
- **Terminal.** Use Windows Terminal (it shows the ✓ of `pwps validate`), font size 18, in the repository folder.
- **SEQSEAL.** Always film the production build: development mode adds a Next.js badge in a corner of every page. Build once, then start the console on the backend chosen in 2.2:

  ```bash
  pnpm install
  pnpm build
  ```

- **Determinism check.** Do it on the local backend, even if you film against AWS: on AWS, each press would add two test-fixture deliveries to the history. Start the console without `SEQSEAL_BACKEND` (`pnpm --filter @seqseal/web start`), open http://localhost:3000 and press **Run deliveries A and B again** 10 times in a row. Each run must end with Delivery A **Unlocked** and Delivery B **Locked: Wrong order**. Then press **Clear results** and stop the console.
- **Freeze the claims.** The tag `evaluation-freeze` marks the commit of the benchmark results (`pnpm benchmark --check`). Tag `demo-final` on the commit you film, and push the tag.

### 2.2 Choose the backend

| Backend | What the video shows | Choose it when |
|---|---|---|
| AWS (preferred) | The deployed system: on the System page, the **Backend** row reads "aws:demo", and the live run is processed on AWS | the rehearsal in 2.3 passes |
| Local | The in-process pipeline: same engines, same policy, same gate | AWS is unavailable, or a rehearsal step fails |

Start the console on AWS (PowerShell, from the repository root):

```powershell
$API = terraform -chdir=infrastructure/terraform/environments/demo output -raw api_endpoint
$env:SEQSEAL_DEMO_TOKEN = aws secretsmanager get-secret-value --region us-east-1 --secret-id seqseal-demo/demo-token --query SecretString --output text
$env:SEQSEAL_BACKEND = "remote"; $env:SEQSEAL_API_URL = $API
pnpm --filter @seqseal/web start          # http://localhost:3000
```

To film locally instead, open a new terminal (the variables above stay set in this one) and run `pnpm --filter @seqseal/web start`.

The rest of this script is the same on both backends. The live run and the replays still post to http://localhost:3000. On AWS, the console forwards each capture to the API with the demo token, and keeps the Ring-derived replay label of a replay. Neither the token nor the API address appears in the terminal.

What differs on AWS:

- **System page.** In the **Verification and action** panel, the **Backend** row reads "aws:demo" and the **Evidence interpreter** row reads "mock-evidence-interpreter@1 (fixture hints, no Bedrock call)": Bedrock is off on this deployment. In a half-width window the panels stack: scroll down to see them.
- **No "Run deliveries A and B again" after a Ring run.** It puts test fixtures on the checklist in place of your Ring pair, and on AWS the history cannot be cleared: only a new Ring run brings a Ring pair back.
- **Clear results** only closes active demo executions, and history stays: the checklist does not empty. It keeps the last released and held pair until the next delivery opens, then shows that delivery. So run A and B just before filming.
- **Replays.** The Monitor's "Replay Ring-derived session" buttons are not offered: replay from the terminal (2.6).
- **Numbers.** Execution and receipt numbers continue from earlier runs. Follow the links on screen (**Receipt SSR-…**) rather than the numbers quoted in this script.
- **Receipts page.** It lists every earlier run, including SSR-0001-v2 and -v3 from before the BN-029 fix. Do not film that list; open receipts from the Monitor panel, as S6 does.
- **AWS console (S8).** Keep the account ID at the top right out of the frame.

### 2.3 Rehearse on AWS

Rehearse once, before the run you record. Whatever runs after A and B becomes the newest delivery and replaces them on the Checklist and Monitor pages.

1. **System page.** The **Backend** row reads "aws:demo", and the interpreter row reads as above. If the interpreter is only "mock-evidence-interpreter@1", the functions predate commit 728bb86: redeploy (`infrastructure/terraform/README.md` §1–2).
2. **The S7 flow.** Follow S7, steps 1 to 5, without recording: **Run ambiguous evidence** gives REVIEW, **Confirm evidence** gives **Unlocked** and a receipt "-v2". Allow a few seconds more than locally for each step.

Do not press **Run deliveries A and B again** during the rehearsal: the S7 flow is enough, and the live run (2.5) checks the rest.

If a step fails, film on the local backend, and record the failure in `docs/FRICTION_LOG.md` if AWS caused it. S8 stays as written: the deployment is real either way.

### 2.4 Choose what data the video shows

| Level | What runs | Label on screen |
|---|---|---|
| 1 (preferred) | A live run through the Ring Developer Playground, just before filming (2.5) | Ring Developer Playground |
| 2 | The live run of 2026-10-19, replayed (2.6) | Ring-derived replay |
| 3 | Test fixtures (**Run deliveries A and B again**) | Test fixture (Ring-shaped replay) |

Rules for the whole video:

- **One level only.** After a level 1 or level 2 run, do not press **Run deliveries A and B again** or any "Run …" button on the Monitor page, except in S7: they put test fixtures on screen.
- **Wording.**
  - Never call level 2 or level 3 "live".
  - Never say "real device" or "real camera" for Playground sources.
  - Never say Ring "detected" a vehicle, a package or motion: Ring's Playground events carry no class (FRICTION_LOG FL-006).

### 2.5 Level 1: the live run, recorded for S3

Arrange the screen for the recording that S3 uses:

- **Left half:** the Ring Developer Playground.
- **Right half:** the SEQSEAL checklist on top, Windows Terminal below.

Keep out of the recording: the Ring token, the taskbar, and the browser tabs and toolbars (crop them in the editor if needed). Set the terminal font to 18 or more.

Then:

1. Press **Clear results** on the checklist page. Locally the checklist empties. On AWS it keeps the previous pair, and switches to Delivery A as soon as its Arrival is accepted.
2. If an earlier run left `demo-a.jsonl` or `demo-b.jsonl` in `fixtures\ring\captures`, rename them: the command would otherwise resume the old session instead of starting a new one. Keep them, since they record a real run (use that run's date):

   ```powershell
   Move-Item fixtures\ring\captures\demo-a.jsonl fixtures\ring\captures\live-2026-10-21-a.jsonl
   Move-Item fixtures\ring\captures\demo-b.jsonl fixtures\ring\captures\live-2026-10-21-b.jsonl
   ```

3. In the Playground, generate a token. It lasts about 30 minutes, and both deliveries took 9 minutes on 2026-10-19. Then scroll the Playground to **Simulate live view event**: the Vehicle, Package and Motion buttons are there, and the token field leaves the screen.
4. In a second terminal (the console keeps running in the first), set the token and the device id, then clear the screen. The token is never written to disk:

   ```powershell
   $env:RING_PLAYGROUND_TOKEN = "<token>"
   $D = "<Playground device id>"
   Clear-Host
   ```

5. Start the screen recording, then run the two deliveries. Do not click inside the terminal during the run: in the classic Windows console, a click starts a selection ("Select" or "Sélection" in the title bar) and pauses the command until you press Esc.

   ```powershell
   pnpm tsx scripts\ring-spike.ts run --device $D --post http://localhost:3000 --delivery A
   pnpm tsx scripts\ring-spike.ts run --device $D --post http://localhost:3000 --delivery B
   ```

For each step, the command prints which simulation to click ("Step 2 of 5, Staging: click PACKAGE in the Playground now"). Click it once in the Playground. The command waits for the Ring event, which Ring lists at the end of the clip (Vehicle about 22 s, Package about 32 s, Motion about 40 s). It then sends the capture to SEQSEAL and moves to the next step.

At the end of each delivery it prints SEQSEAL's result, once the receipt exists (on AWS, a few seconds after the last step). On 2026-10-19:

```text
Delivery A (EXEC-0001): SEALED -> RELEASE, workflow RELEASED.
Delivery B (EXEC-0002): DEVIATED -> HOLD, workflow HELD.
  STORAGE occurred 54 s before required STAGING. (ORDER-02)
```

On AWS, the execution numbers are higher: they continue from earlier runs.

| Step | Click in the Playground | Delivery A | Delivery B |
|---|---|---|---|
| Arrival | Vehicle | 1st | 1st |
| Staging | Package | 2nd | **3rd** |
| Storage | Motion | 3rd | **2nd** |
| Departure | Vehicle | 4th | 4th |
| Clear | Motion | 5th | 5th |

What the command guarantees:

- **Steps from the configuration.** The steps come from the protocol and the mappings: A follows the expected sequence, and B swaps the two states of the signature rule.
- **Ring events only.** Every step is a Ring history event, and nothing falls back to a status probe. A click made before the step was shown does not count.
- **Deadlines.** It prints them, for example "Staging must start before 14:53:08 UTC (TEMP-01: within 7 min of Arrival)".
- **One delivery at a time.** It refuses to start B while A is open.
- **Resuming.** It stops without sending anything if no event comes after three waits or if the token expires. The same command then resumes where it stopped.
- **Network errors.** A dropped connection prints "network error … asking again", and the next poll retries.

If you need to start over: press **Clear results**, delete `fixtures\ring\captures\demo-a.jsonl` and `demo-b.jsonl`, and run again. Do not reuse the names `live-2026-10-19-*`, which hold the reference run.

### 2.6 Level 2: the live run of 2026-10-19, replayed

1. Press **Clear results** on the checklist page.
2. Replay the two saved sessions, and wait about 10 s after each.
   - **Locally:** on the **Monitor** page, press **Replay Ring-derived session live-2026-10-19-a (5 captures)**, then **… live-2026-10-19-b (5 captures)**.
   - **On AWS:** from the terminal, through the console:

     ```powershell
     pnpm replay --captures fixtures/ring/captures/live-2026-10-19-a.jsonl --remote http://localhost:3000
     pnpm replay --captures fixtures/ring/captures/live-2026-10-19-b.jsonl --remote http://localhost:3000
     ```

If you want a clip for S3 at this level, record the Monitor page during the second replay.

### 2.7 Check before filming

- **Checklist page.** It shows the level's label, Delivery A **Unlocked** and Delivery B **Locked: Wrong order**.
- **Monitor page.** It shows Delivery B: ORDER-02 failed, DEVIATED, HOLD.
- **Receipts page.** Locally, it lists SSR-0001 (A) and SSR-0002 (B), and nothing else. On AWS it also lists earlier runs (2.2).

## 3. Shot by shot

The pointer moves slowly and stops on what the narration names. Each "Say" block is the exact text, followed by its word count.

### S1 · 0:00–0:12 · The Obvious Magic (12 s)

![S1](demo/s01-walkthrough.jpg)

**Film**

1. Open the **Checklist** page. Deliveries A and B are side by side. Park the pointer in the empty area at the top right.
2. Start recording, wait 1 s, and click **Play the 12-second walkthrough**. Do not touch the mouse for 12 s.

**On screen**, in this order:

1. Delivery B: "Every box is checked." then "So why is Release still locked?"
2. B's Storage and Staging rows: "Wrong order: Storage 14:51, then Staging 14:52."
3. Delivery A: "Right order: Staging 14:46, then Storage 14:47." then "Release unlocked."
4. Both deliveries: "Right order → Release. Wrong order → Hold." then "SEQSEAL. A checklist that can see."

The captions use the times on screen; test fixtures show 14:03 and 14:06.

**Say** (23 words; first sentence at 0 s, second at about 1.5 s, third from about 3 s)

> Every box is checked. So why is Release still locked? Because seeing every step doesn't prove the process happened in the right order.

**Edit:** start the shot on the frame after the click.

### S2 · 0:12–0:27 · Same steps, different order (15 s)

![S2](demo/s02-release-b.jpg)

**Film**

1. On the **Checklist** page, click the **Release delivery** button of **Delivery B** (right card, marked Locked).
2. The panel opens. Scroll down slowly until the whole Delivery B card is visible, including the panel.
3. Stop the pointer on the badge "came before Staging" when you say "Storage came before Staging".

**On screen**

- "ORDER-02 failed";
- "Expected: STAGING before STORAGE";
- "Observed: STORAGE 14:51, STAGING 14:52";
- the HOLD chain ("because Action policy IDP-ACTION@1.0.0 maps DEVIATED → HOLD …");
- Delivery A still **Unlocked** on the left.

**Say** (34 words)

> Delivery B went through the same five steps as A, under the same protocol and policy. But Storage came before Staging: ORDER-02 fails, and Release stays locked. Same observations. Different sequence. Different operational action.

### S3 · 0:27–0:45 · Ring gives the checklist eyes (18 s)

**Film:** nothing new. Use the recording made during the live run (2.5), cut into three pieces. Take the Staging step of Delivery A ("click PACKAGE"):

1. **About 4 s.** The terminal shows "Step 2 of 5, Staging: click PACKAGE in the Playground now", and the pointer clicks Package in the Playground.
2. **About 7 s.** The Package clip plays in the Playground. If you speed it up, show the factor on screen, for example "×3".
3. **About 7 s.** The terminal shows "[ok] Staging: Ring event … SEQSEAL accepted it." and the Staging box checks on the checklist. The label "Ring Developer Playground" stays visible.

**Say** (38 words)

> Ring gives the checklist eyes. Here, the footage is simulated by the Ring Developer Playground. Ring records each clip as an event in its history, and SEQSEAL binds every step of the delivery to one of those events.

**At level 2**, film the Monitor page while **Replay Ring-derived session live-2026-10-19-b** runs, then say (31 words):

> Ring gives the checklist eyes. These deliveries were captured live from the Ring Developer Playground on October 19. Every step is a Ring history event, replayed here through the same pipeline.

### S4 · 0:45–1:11 · Deterministic verification, down to the Ring event (26 s)

![S4 verification](demo/s04-verification.jpg)
![S4 evidence drawer](demo/s04-evidence-drawer.jpg)

**Film**

1. In Delivery B's panel, click **Open the full verification**. The verification page of EXEC-0002 opens: the checklist card on the left, **Operational gate** on the right.
2. Scroll to **Expected versus observed**. The orange lines cross between STAGING and STORAGE. Hold 3 s.
3. Scroll to **Why**. Stop the pointer on the ORDER-02 row: "FAIL — STORAGE occurred 54 s before required STAGING." (54 s on 2026-10-19; your run shows its own number). Hold 3 s.
4. Scroll back up and click the observed **STORAGE** box in **Expected versus observed**. The **STORAGE evidence** panel opens.
5. Move the pointer down "Source event" (the Ring event id), "Request" (the Ring request id), "Ring proof: Ring history event (on_demand)…" and "Time from: Start of the Ring event", about 1.5 s each.

**Say** (59 words; say the number of seconds shown in the ORDER-02 row: 54 for the 2026-10-19 run)

> The expected process is declared in PWPS. The engine lays the observed sequence over it and checks every rule deterministically: no model decides. ORDER-02 fails because Storage occurred fifty-four seconds before Staging. And every step leads back to its source: this one is a Ring history event, with its event ID, its Ring request ID and its start time.

### S5 · 1:11–1:29 · Verdict and action are separate (18 s)

![S5](demo/s05-operational-gate.jpg)

**Film**

1. Close the panel and open the **Monitor** page. It shows the last delivery, B. Do not press any button on this page.
2. Scroll slowly down the left panel, from top to bottom:
   - the crossed lanes;
   - "ORDER-02 failed";
   - **DEVIATED**;
   - "Action policy IDP-ACTION 1.0.0 maps DEVIATED to HOLD";
   - the **HOLD** banner;
   - "Receiving workflow PENDING to HELD via **WorkflowHeld**".
3. Stop the pointer on "WorkflowHeld" for the last sentence.

**Say** (39 words)

> Verdict and action are kept apart. The engine says DEVIATED. A separate, versioned policy maps DEVIATED to HOLD, and SEALED to RELEASE. The Operational Gate then holds the receiving workflow, with a real WorkflowHeld event, not just a label.

### S6 · 1:29–1:47 · The SeqSeal Receipt (18 s)

![S6](demo/s06-receipt.jpg)

**Film**

1. On the Monitor panel, click **Receipt SSR-0002** (bottom right; on AWS the number may differ). The page "SeqSeal Receipt SSR-0002" opens.
2. Show the HOLD banner and **Why this action**. Pass the pointer over the hashes under **Protocol and policy**.
3. Click **Replay verification**. The banner reads: "Matches the original receipt. Same protocol hash, evidence set and engine gave verdict DEVIATED; the same policy hash gave action HOLD. Receipt hash is valid." Hold 3 s.

**Say** (41 words)

> Every final decision produces a SeqSeal Receipt. It links the action to the policy, the verdict, the failed rule and the Ring evidence, each with its hash. Replay verification runs it again and finds the same verdict and the same action.

### S7 · 1:47–2:10 · AI can propose evidence, not release (23 s), filmed last

![S7 needs review](demo/s07-needs-review.jpg)
![S7 confirmed](demo/s07-confirmed.jpg)

**Film**

1. On the **Monitor** page, click **Run ambiguous evidence**, then wait about 10 s. In the edit, keep only the click.
2. The Monitor panel now shows "Execution D — Ambiguous Evidence":
   - STAGING? with a dashed line;
   - "ORDER-02 not evaluable yet";
   - **UNCERTAIN**, then "Action policy IDP-ACTION 1.0.0 maps UNCERTAIN to REVIEW";
   - the purple **REVIEW** banner;
   - "Receiving workflow PENDING to REVIEW REQUIRED".

   Hold 3 s.
3. Click the execution link under the title (EXEC-0003 when A and B were the only runs before). The verification page opens, and its top right reads "Source: Test fixture (Ring-shaped replay)". Show:
   - Staging with a dashed "?" box, **Release delivery** "Locked", and "Needs review: Potential STAGING evidence could not be verified reliably.";
   - **Operational gate**: Input verdict UNCERTAIN, Output REVIEW, Workflow REVIEW REQUIRED.
4. Scroll to **Evidence**. On the row **STAGING?** ("AI_ASSISTED, AMBIGUOUS LOW", status UNCERTAIN), click **Confirm evidence**. The message reads "Evidence updated. The engine re-evaluated the protocol."
5. Scroll back to the top. Show:
   - Staging checked, **Unlocked**, and "ORDER-02 passed";
   - **Operational gate**: SEALED, RELEASE, "REVIEW_REQUIRED to RELEASED (WorkflowReleased)";
   - the link **Receipt SSR-0003-v2**.

**Say** (49 words)

> When Ring metadata isn't enough, an AI interpreter may propose evidence. In this test fixture it can't tell reliably whether Staging happened, so the delivery goes to review, not release. A supervisor confirms the evidence, never the outcome. The engine re-evaluates, releases the delivery, and issues a second receipt.

**Why last:** this test fixture becomes the newest delivery. When A and B come from Ring (levels 1 and 2), the Checklist and Monitor pages then show it instead of A and B. This was checked on 2026-10-19.

**Do not say** that Bedrock made this call. Locally and on the AWS deployment alike, the interpreter is a deterministic stand-in: the **System** page reads "mock-evidence-interpreter@1 (fixture hints, no Bedrock call)".

### S8 · 2:10–2:25 · AWS (15 s)

**Film**

1. Open `docs/ARCHITECTURE.md` at **4. Runtimes › AWS** in the VS Code Markdown preview or on GitHub. Show the diagram: Ring webhook and Playground → API Gateway → EventBridge → SQS → Lambdas → DynamoDB and S3.
2. Show the `infrastructure/terraform` folder (`main.tf`, `modules/`).
3. In the AWS console (us-east-1), show **Lambda › Functions** filtered on `seqseal-demo` (13 functions), or the CloudWatch dashboard `seqseal-demo-source-to-action` after a run. Keep the account ID at the top right out of the frame.
4. If the video is filmed against AWS (2.2): show the **System** page for 2 s, on the **Backend** row: "aws:demo".

**Say** (32 words)

> SEQSEAL runs on AWS, deployed with Terraform: each stage is a Lambda behind EventBridge and SQS. Bedrock is a side branch, and the roles that decide carry an explicit deny on Bedrock.

If the stack has been destroyed before filming, skip step 3 and say instead (33 words): "SEQSEAL ships an event-driven AWS deployment as Terraform: each stage is a Lambda behind EventBridge and SQS. Bedrock is a side branch, and the roles that decide carry an explicit deny on Bedrock."

### S9 · 2:25–2:37 · PWPS (12 s)

![S9](demo/s09-protocol.jpg)

**Film**

1. In the terminal, type `pnpm pwps validate protocols/inbound-delivery.yaml`. It prints:

   ```text
   ✓ PWPS 0.1 valid  protocols/inbound-delivery.yaml
   Protocol: IDP-01@1.0.0
   States: 5
   Constraints: 11
   ```

2. Switch to the **Protocol** page. Show the ARRIVAL › STAGING › STORAGE › DEPARTURE › CLEAR sequence, the ORDER-02 row, and the **Action policy** table.

**Say** (21 words)

> And the protocol isn't hard-coded. It's written in PWPS, our open-source Physical Workflow Protocol Specification, with a validator and conformance tests.

### S10 · 2:37–2:45 · Close (8 s), filmed right after S2

![S10](demo/s10-close.jpg)

**Film:** the **Checklist** page, with Delivery A **Unlocked** and Delivery B **Locked**. Collapse B's panel if it is open, and park the pointer outside the cards. Hold 8 s. In the edit, you can add a slow zoom on the two buttons and the SEQSEAL logo for the last 2 s.

**Say** (14 words)

> Ring observes. SEQSEAL verifies whether the workflow can proceed. A checklist that can see.

## 4. Filming order and editing

Film in this order, then put the shots back in timeline order (S1 to S10) in the editor:

| Order | Shots | Why |
|---|---|---|
| 1 | S3 | Recorded during the live run (2.5) |
| 2 | S1, S2, S10 | The Checklist page with A and B |
| 3 | S4, S5, S6 | Verification, Monitor and receipt of Delivery B |
| 4 | S9, S8 | Terminal, documentation and the AWS console; they do not depend on the data |
| 5 | S7 | Last: it puts a test fixture on the Checklist and Monitor pages |

Editing rules:

- **Cuts only.** Cut waits and page loads. Do not change what the screen shows.
- **Speed-ups.** Only in S3 and in S7's wait, and show the factor (×3) whenever footage is sped up.
- **Source label.** Keep it readable (top right, "Source: …") whenever deliveries are on screen.
- **Length.** The video must stay under 3:00 (rules: public on YouTube or Vimeo, in English, under 3 minutes). This script ends at 2:45, and judges are not required to watch beyond 3:00.
- **Subtitles.** They are welcome; use the text of section 5.

## 5. Full narration (to record in one take)

> **[S1 · 0:00]** Every box is checked. So why is Release still locked? Because seeing every step doesn't prove the process happened in the right order.
>
> **[S2 · 0:12]** Delivery B went through the same five steps as A, under the same protocol and policy. But Storage came before Staging: ORDER-02 fails, and Release stays locked. Same observations. Different sequence. Different operational action.
>
> **[S3 · 0:27]** Ring gives the checklist eyes. Here, the footage is simulated by the Ring Developer Playground. Ring records each clip as an event in its history, and SEQSEAL binds every step of the delivery to one of those events.
>
> **[S4 · 0:45]** The expected process is declared in PWPS. The engine lays the observed sequence over it and checks every rule deterministically: no model decides. ORDER-02 fails because Storage occurred fifty-four seconds before Staging. And every step leads back to its source: this one is a Ring history event, with its event ID, its Ring request ID and its start time.
>
> **[S5 · 1:11]** Verdict and action are kept apart. The engine says DEVIATED. A separate, versioned policy maps DEVIATED to HOLD, and SEALED to RELEASE. The Operational Gate then holds the receiving workflow, with a real WorkflowHeld event, not just a label.
>
> **[S6 · 1:29]** Every final decision produces a SeqSeal Receipt. It links the action to the policy, the verdict, the failed rule and the Ring evidence, each with its hash. Replay verification runs it again and finds the same verdict and the same action.
>
> **[S7 · 1:47]** When Ring metadata isn't enough, an AI interpreter may propose evidence. In this test fixture it can't tell reliably whether Staging happened, so the delivery goes to review, not release. A supervisor confirms the evidence, never the outcome. The engine re-evaluates, releases the delivery, and issues a second receipt.
>
> **[S8 · 2:10]** SEQSEAL runs on AWS, deployed with Terraform: each stage is a Lambda behind EventBridge and SQS. Bedrock is a side branch, and the roles that decide carry an explicit deny on Bedrock.
>
> **[S9 · 2:25]** And the protocol isn't hard-coded. It's written in PWPS, our open-source Physical Workflow Protocol Specification, with a validator and conformance tests.
>
> **[S10 · 2:37]** Ring observes. SEQSEAL verifies whether the workflow can proceed. A checklist that can see.

## 6. Submission story

> Every box can be checked and the physical process can still be wrong. SEQSEAL gives a receiving checklist eyes. Ring observes what actually happened. SEQSEAL verifies whether those steps occurred in the required order. Release only unlocks when the workflow is supported by sufficient evidence.
>
> Same observations. Different sequence. Different operational action.

For technical judges:

> Ring provides physical observations. PWPS defines expected execution. SEQSEAL builds traceable evidence and evaluates the sequence deterministically. A separate versioned policy converts the resulting verdict into an operational action. Both deliveries ran live through the Ring Developer Playground, every step bound to a Ring history event: A was released, and B was held because Storage came 54 s before Staging. SEQSEAL runs on AWS, deployed with Terraform: on October 21 both deliveries ran live again, processed on the AWS deployment, with the same outcome (A released, B held, Storage 49 s before Staging).

## 7. What the judge should remember

1. Every box is checked. Release is still locked.
2. Ring gives the checklist eyes.
3. AI can propose evidence. It cannot release the workflow.
4. Same observations. Different sequence. Different operational action.

## 8. Questions judges ask

| Question | Answer and where to show it |
|---|---|
| Is that actually Ring? | Read the source label and name the level honestly: Playground, Ring-derived replay or test fixture. At levels 1 and 2, every step is a Ring history event. The evidence drawer shows the event id, the Ring request id, "Ring proof" and "Time from". The ids of the 2026-10-19 run are in [ring-playground-observations.md](ring-playground-observations.md) §7. |
| Does Ring say it was a vehicle? | No. Playground events are `on_demand`, with an empty `cv_detections`. The operator declares each step's source and zone, and the drawer says so (FRICTION_LOG FL-006). A production integration maps the Ring webhook's detection subtype through the configured mappings. |
| Which protocol, which policy? | The **Protocol** page. Every receipt shows both, with their hashes. |
| What if a camera is offline? | The verdict is UNCERTAIN → REVIEW, never HOLD and never RELEASE (benchmark B08). |
| Can a reviewer just release it? | No. Reviewers confirm or reject evidence, and the engine re-evaluates (B23, B24). |
| Was the AI step Bedrock? | No. Locally and on the AWS deployment (`enable_bedrock_evidence = false`), the **System** page shows the deterministic stand-in ("no Bedrock call"). When Bedrock is turned on, only the media interpreter may call it, and only to propose evidence. |
| What does HOLD do? | It stops the receiving workflow from proceeding automatically. It does not lock doors or stop machinery. |
| Biggest limitation? | One active delivery per lane: multi-delivery correlation is future work (BUILD_NOTES BN-015). In the Playground, the source of each step is declared by the operator. |
| What is open source? | `packages/pwps`: spec, schema, parser, validator, canonicalizer, hash, compiler, CLI, examples and conformance tests (Apache-2.0). |
