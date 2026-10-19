# Ring Developer Playground observations

This sheet records what the live Ring API returns for the account used in the demo. It grounds the bindings and mappings in observed data instead of assumptions.

**Status (2026-10-19, 14:55 UTC):** Deliveries A and B were captured live through the Ring Developer Playground, with every one of their ten steps bound to a Ring history event. A was released; B was held on ORDER-02 (§7). Fill the rest from `fixtures/ring/spike-<timestamp>/` and the capture output, never from documentation. To run the discovery:

```bash
export RING_PLAYGROUND_TOKEN=…        # one-click Playground token, never written to disk
pnpm tsx scripts/ring-spike.ts discover
```

## 1. Session

| Field | Value |
|---|---|
| Date (UTC) | 2026-10-18 08:47 |
| API base URL used | `https://api.amazonvision.com` (default) |
| Token lifetime observed | About 30 minutes. A token's `exp` claim read at 09:05 UTC gave 09:34 UTC (29 min left); an earlier token was refused about 11 min after a successful discovery (FRICTION_LOG FL-005) |
| Spike folder | `fixtures/ring/spike-2026-10-18T08-47-31-685Z/` |

Discovery calls, all HTTP 200:

| Call | Duration |
|---|---|
| `GET /v1/users/me` | 1288 ms |
| `GET /v1/devices?include=status,capabilities,configurations` | 798 ms |
| `GET /v1/devices/{id}/status` | 590 ms |
| `GET /v1/devices/{id}/capabilities` | 931 ms |
| `GET /v1/devices/{id}/configurations` | 915 ms |
| `GET /v1/history/devices/{id}/events` | 871 ms |

## 2. Devices (`GET /v1/devices?include=status,capabilities,location,configurations`)

One device was returned. The response is JSON:API: `data[]` (type `devices`) with `relationships` to `location`, `configurations`, `capabilities` and `status`, the related records in `included[]`, and `meta.time`.

| Field | Observed value (from `devices.json`, 2026-10-18 08:47 UTC) |
|---|---|
| Device id | `ava1.ring.device.DJXHOX5NRJIDNGWFTA74YI45P4WJGLK6GPLAWU7HA7YHPDVQ4LRHUL2J4ZZK6FUOLZPKQSHJKXRNK2VYXYIPD4N5ZJIKO3RA` |
| Name / image | "Playground Device"; image of a Doorbell Pro (`DoorbellPro/rvdp_3x.png`) |
| Components | none listed (single camera; no `component_id` needed) |
| Status (`device-status`) | `online: false`, `state: null`, `reported_at: 2026-10-18T08:28:53Z` while no simulation was running |
| Video | 1080p, AVC, 16:9 |
| Motion detection | configurable `enabled` and `motion_zones`; configured `enabled: on` with one full-frame motion zone |
| Image enhancements | `color_night_vision`, `privacy_zones`, `snapshot` |
| Other detections | contact, flood, glass break, tamper, freeze, smoke, CO: `null` |
| End-to-end encryption | disabled |

Consequence for SEQSEAL: the Playground exposes one device, so the five dock zones of a Playground session are declared per capture (`--zone`), as designed; no component binding is needed.

## 3. Event history (`GET /v1/history/devices/{id}/events`)

| When (UTC) | Response | Notes |
|---|---|---|
| 08:47 (discovery) | `{"data": []}` | JSON:API `data` array, empty: no simulation had been run with that token |
| 09:05 (first capture, VEHICLE) | no event within 60 s | capture fell back to a status probe (HTTP 200, request id `c93463d7-e04f-4bd7-8187-74d69278d597`). Whether the simulation had been run after the token was issued is to be confirmed |
| 16:22 (capture, VEHICLE) | one new `history-events` item, id `…DZKCH44U…` | HTTP 200, request id `a38ea6fb-5ca2-48e9-8ee6-b5717d590ad8`. `start` 16:21:31.490, `end` 16:21:53.250 (21.8 s). Returned at the first poll, 31.6 s after its end |
| 16:23 (capture, VEHICLE) | one new `history-events` item, id `…R4BHNYLH…` | HTTP 200, request id `3ac0abbb-9241-4711-9e74-0c0e2a891bc7`. `start` 16:22:26.024, `end` 16:22:47.784 (21.8 s). The command was started right after the previous capture and polled every 5 s; the event was first returned at 16:23:14.3, 26.6 s after its end |

Shape of one item, verbatim except for the shortened ids:

```json
{
  "type": "history-events",
  "id": "ava1.ring.history.event.DZKCH44U…",
  "attributes": { "end": 1792340513250, "is_third_party_reviewed": true, "event_type": "on_demand", "start": 1792340491490 },
  "relationships": {
    "cv_detections": { "data": [] },
    "source": { "data": { "type": "devices", "id": "ava1.ring.device.DJXHOX5…" } }
  },
  "meta": { "riid": null }
}
```

What this establishes:

- **Time fields.** `attributes.start` and `attributes.end`, epoch milliseconds. There is no `timestamp` field. SEQSEAL uses `start` as the physical time and keeps `end` (`ring_event.ended_at`).
- **Event type.** `on_demand`, consistent with a live-view session: the Playground simulation is a live view.
- **Duration.** Both VEHICLE simulations lasted 21.8 s.
- **Delay.** The event was returned 26–32 s after its end. The second capture suggests it is listed only after the simulation ends, but the exact delay was not measured. The capture command now prints how long it waited.
- **No classification.** `cv_detections` is empty: nothing in the event says a vehicle was shown. The simulated source can only come from the operator (`--source`), as designed (BUILD_NOTES BN-003; FRICTION_LOG FL-006).
- **Other fields.** `is_third_party_reviewed: true`; `meta.riid: null`; `relationships.source` names the device.

### 16:55–17:09 UTC: ten simulations, no new history event

A new token was generated at about 16:53 (valid until 17:23). Deliveries A and B were then captured, one simulation per step (VEHICLE, PACKAGE, MOTION).

- Each of the ten captures polled the history for 60 s. The newest event Ring listed stayed `…R4BHNYLH…` (start 16:22:26), from the earlier session.
- So every capture fell back to a status probe (`GET /v1/devices/{id}/status`, HTTP 200), and its time is the capture time.
- The history call itself kept answering HTTP 200. The old events were still listed with the new token, so history is not limited to the token's own lifetime.

No event at all was recorded between 16:23 and 17:35 UTC. The operator then found that the simulation has to be played in the Playground for its event to exist, and the captures had been run without one playing (operator report, 17:53). This is not Ring friction.

### 17:35–17:51 UTC: every simulation played produced an event

`ring-spike.ts history` at 17:38:32 (request id `2fc36400-fb53-4e2f-bc87-4314151c7aff`, 9 787 ms):

- 5 events on one page, newest first, no `links.next`;
- 3 new events: 17:35:15 (21.8 s), 17:36:09 (31.7 s) and 17:37:18 (39.7 s), plus the two from 16:21–16:22.

Captures bound to a Ring event:

| Declared source → zone | Event start–end (UTC) | Duration | Listed |
|---|---|---|---|
| VEHICLE → receiving-entry | 17:37:18.232–17:37:57.943 | 39.71 s | before the command ran |
| PACKAGE → staging | 17:49:12.666–17:49:34.425 | 21.76 s | at most 6.4 s after the end |
| VEHICLE → receiving-exit | 17:50:03.304–17:50:43.014 | 39.71 s | at about the end (found 0.6 s before it, by this computer's clock) |
| MOTION → receiving-exit | 17:50:51.242–17:51:13.001 | 21.76 s | at most 5.6 s after the end |

What this establishes:

- **Timing.** The event is listed at about the end of the simulation. The 26–32 s measured at 16:22 included the time before the command was started.
- **Duration.** Each simulation is a fixed-length clip: 21.76 s and 39.71 s here, and once 31.7 s. Vehicle lasted 39.71 s in this session, but the VEHICLE events at 16:21–16:22 lasted 21.76 s. So the duration does not identify the source either (FL-006).
- **Order of operations.** Click the simulation first, then run the capture: it waits for the event. Started the other way round, a 40 s Vehicle clip can end after a 60 s wait (it was found after 58 s at 17:50). The default wait is now 90 s.
- **Latency.** History calls took up to 9.8 s, and three were cut off by the client's 10 s timeout (FL-007).

The six captures run between 17:40 and 17:48 found no new event, because no simulation was played during their wait. `--require-event` refused them, and nothing was sent.

Still to observe: the PACKAGE and MOTION events (type, `cv_detections`).

## 4. Simulated sources (Package, Vehicle, Motion)

| Source | API calls made | HTTP status | Request id | What the response contains |
|---|---|---|---|---|
| PACKAGE | | | | |
| VEHICLE | `GET /v1/history/devices/{id}/events` | 200 | `a38ea6fb-…`, `3ac0abbb-…` | one `history-events` item per simulation; `event_type: on_demand`; `cv_detections` empty |
| MOTION | | | | |

## 5. Consequences for SEQSEAL configuration

After filling sections 2–4:

- **Bindings.** Record the real device ids replacing `ring-device-entry`, `ring-device-staging`, `ring-device-storage` and `ring-device-exit` in `config/inbound-delivery.sources.yaml`.
- **Mappings.** Note any mapping that must change because a `subType` is never returned, or a new one appears.
- **Precision.** Physical timestamps are present (`attributes.start`, epoch ms), so the ±30 s fallback of BUILD_NOTES BN-004 is not needed. Precision stays at 1 s.
- **Friction.** Any friction goes into [FRICTION_LOG.md](FRICTION_LOG.md).

## 6. Captures used in the demo

Delivery A (session `demo-a`); Delivery B uses `--session demo-b` and swaps the second and third commands:

```bash
pnpm tsx scripts/ring-spike.ts capture --device <id> --source VEHICLE --zone receiving-entry    --post http://localhost:3000 --session demo-a
pnpm tsx scripts/ring-spike.ts capture --device <id> --source PACKAGE --zone staging            --post http://localhost:3000 --session demo-a
pnpm tsx scripts/ring-spike.ts capture --device <id> --source MOTION  --zone storage-transition --post http://localhost:3000 --session demo-a
pnpm tsx scripts/ring-spike.ts capture --device <id> --source VEHICLE --zone receiving-exit     --post http://localhost:3000 --session demo-a
pnpm tsx scripts/ring-spike.ts capture --device <id> --source MOTION  --zone receiving-exit     --post http://localhost:3000 --session demo-a
```

Each capture is saved to `fixtures/ring/captures/<session>.jsonl` and can be replayed later as Ring-derived replay.

| Capture id | Ring event id (type) | Source | Declared zone | Ring request id | Resulting evidence | Execution |
|---|---|---|---|---|---|---|
| `pg-…DZKCH44U…` (16:22:24 UTC, session `demo-a`) | `…DZKCH44U…` (`on_demand`) | VEHICLE | receiving-entry | `a38ea6fb-5ca2-48e9-8ee6-b5717d590ad8` | ARRIVAL | opened the execution |
| `pg-…R4BHNYLH…` (16:23:14 UTC, session `demo-a`) | `…R4BHNYLH…` (`on_demand`) | VEHICLE | receiving-entry | `3ac0abbb-9241-4711-9e74-0c0e2a891bc7` | a second ARRIVAL | UNCERTAIN → REVIEW: "A second independent ARRIVAL was observed while the execution is active" |

The second row repeated the Arrival step in the same session. SEQSEAL behaved as designed (one active delivery per lane, BUILD_NOTES BN-015): it could not tell which delivery later steps belong to, so it asked for review instead of guessing. That session is discarded and Delivery A is captured again. The capture command now refuses the same simulation in the same zone twice in one session (BN-024).

Both captures were sent before the parser read `start`, so their physical time was the capture time (31.6 s and 26.6 s after the end of the simulation). Captures made from now on use `start`.

Sessions `demo-a` and `demo-b` (16:55–17:09 UTC), captured again from scratch:

| Delivery | Steps (capture time, UTC) | Ring calls | Result |
|---|---|---|---|
| A (`demo-a`) | Arrival 16:55:55, Staging 16:57:24, Storage 16:58:42, Departure 17:00:33, Clear 17:02:07 | five `GET …/status`, HTTP 200; request ids `d662ea4f-…`, `74fe6f8d-…`, `e17ac412-…`, `50a6252b-…`, `91303857-…` | SEALED → RELEASE, workflow RELEASED |
| B (`demo-b`) | Arrival 17:03:38, Storage 17:05:27, Staging 17:06:54, Departure 17:08:06, Clear 17:09:15 | five `GET …/status`, HTTP 200; request ids `e4b99401-…`, `0bf53a82-…`, `a5ef4f12-…`, `9d2d0b8a-…`, `efe5fd07-…` | DEVIATED → HOLD (ORDER-02: Storage 17:05 before Staging 17:06), workflow HELD |

The whole chain ran live: capture, Ring API call, SEQSEAL pipeline, verdict, policy, Operational Gate. Each step's evidence, however, is the operator's declaration plus a Ring status call, not a Ring event. The evidence drawer says "Ring API call only" for these steps.

Sessions `demo-a` and `demo-b` (17:37–17:51 UTC, `--require-event`):

- `demo-a` got only its Arrival (17:37:18).
- `demo-b` got Staging, Departure and Clear (17:49–17:50), but no Arrival.
- SEQSEAL knows lanes, not sessions, so all four steps formed one delivery: Arrival 17:37:18, then Staging 11.9 min later. The verdict was DEVIATED → HOLD (TEMP-01, limit 7 min); Storage was missing.

The capture command now checks the open delivery on the lane before calling Ring (BUILD_NOTES BN-026). These sessions are discarded.

## 7. Live deliveries A and B, every step bound to a Ring event (2026-10-19)

Command: `ring-spike.ts run --delivery A`, then `--delivery B` (BUILD_NOTES BN-027), against `pnpm demo` on the developer's machine, with one token valid until 15:14 UTC. For each step the command named the simulation to click, and the operator clicked it once in the Playground.

**Delivery A** (session `demo-a`, EXEC-0001):

| Step | Clicked | Ring event (end of id) | Start–end (UTC) | Clip | Ring request id |
|---|---|---|---|---|---|
| Arrival | VEHICLE → receiving-entry | `…YDQYNXNM7A7H` | 14:46:08–14:46:29 | 21.8 s | `f8854f29-f8e5-4803-b89e-b83105d50bc2` |
| Staging | PACKAGE → staging | `…YOIENPHGWEUD` | 14:46:57–14:47:29 | 31.8 s | `066e2403-312e-41d4-8e14-9282cac50d98` |
| Storage | MOTION → storage-transition | `…F6VMWGIHV75G` | 14:47:52–14:48:32 | 39.7 s | `8406bb89-3edb-4ad2-a40e-5f44c77a109a` |
| Departure | VEHICLE → receiving-exit | `…T5JBMPDLLXWR` | 14:48:49–14:49:11 | 21.8 s | `47c9a7b7-2291-4969-8333-0dbc620c7cc3` |
| Clear | MOTION → receiving-exit | `…3TO76GZSITEG` | 14:49:37–14:50:17 | 39.7 s | `c980a8c3-0f4f-4582-b5fb-a92d18aeffa2` |

Result read from SEQSEAL: **SEALED → RELEASE, workflow RELEASED**. "All mandatory protocol constraints are satisfied by accepted evidence."

**Delivery B** (session `demo-b`, EXEC-0002):

| Step | Clicked | Ring event (end of id) | Start–end (UTC) | Clip | Ring request id |
|---|---|---|---|---|---|
| Arrival | VEHICLE → receiving-entry | `…XAMWVWS4XCX4` | 14:50:40–14:51:01 | 21.8 s | `f489a665-0219-4771-8ee8-50c7648ba738` |
| Storage | MOTION → storage-transition | `…DZBGWTXKRAMT` | 14:51:16–14:51:56 | 39.7 s | `961e4166-47fd-4052-86f4-a64f6f367e69` |
| Staging | PACKAGE → staging | `…4SPHYWNJPAK3` | 14:52:10–14:52:41 | 31.7 s | `f77efeeb-206f-46ea-ae1f-f6e660bd1801` |
| Departure | VEHICLE → receiving-exit | `…PCEZYH2FBGYB` | 14:52:54–14:53:16 | 21.8 s | `4203341b-2f29-43a0-a340-f6abf5c4c30c` |
| Clear | MOTION → receiving-exit | `…UXOMIJCBSFA3` | 14:54:38–14:55:18 | 39.7 s | `bbef03d1-01b5-4118-bf58-ba14a58def0b` |

Result read from SEQSEAL: **DEVIATED → HOLD, workflow HELD**. "STORAGE occurred 54 s before required STAGING. (ORDER-02)"

What this run establishes:

- **The Winning Moment holds on live Ring events.** The two deliveries have the same five Ring-observed steps, protocol, policy and mappings. Only the order differs, and so do the verdict and the action.
- **Clip lengths.** In this run, where every click followed a printed instruction, each simulation had its own fixed clip length:

  | Simulation | Clip length | Clicks |
  |---|---|---|
  | Vehicle | 21.76 s | 4 |
  | Package | 31.7 s | 2 |
  | Motion | 39.71 s | 4 |

  This matches the 16:21–16:22 VEHICLE events of 2026-10-18. It also suggests that the three test clicks of 17:35–17:37 that day were Vehicle, Package and Motion, and that the 17:39 capture declared as VEHICLE actually took the Motion test clip. The guided command now ignores events that started before the step was shown.
- **The clip length is a fingerprint, not a classification.** It identifies the Playground footage, not what Ring detected. `cv_detections` stayed empty for every event seen so far, whatever the simulation (FRICTION_LOG FL-006).
- **Waiting.** Each step waited about 30 s, which is the clip length plus the listing delay.
- **Network.** Two history polls failed with a network error ("fetch failed"). The next poll succeeded, and no step was lost.

The two session files were reviewed and committed as `fixtures/ring/captures/live-2026-10-19-a.jsonl` and `live-2026-10-19-b.jsonl`.

- **Content.** They hold the Playground device id, the Ring event ids and times, the Ring request ids, and each Ring history item as returned. They hold no token and no account data.
- **Replay.** `pnpm replay --captures` on each file gives the same results as the live run: A SEALED → RELEASE, and B DEVIATED → HOLD with "STORAGE occurred 54 s before required STAGING". `tests/ring-live-sessions.spec.ts` pins both results on this real data.
- **In the web app.** The Monitor page lists both sessions and replays them as Ring-derived replay.

