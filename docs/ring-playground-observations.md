# Ring Developer Playground observations

This sheet records what the live Ring API returns for the account used in the demo. It grounds the bindings and mappings in observed data instead of assumptions.

**Status (2026-10-18): discovery done; first Ring history events captured at 16:21–16:23 UTC (VEHICLE); a clean A/B session is still to run.** Fill the rest from `fixtures/ring/spike-<timestamp>/` and the capture output, never from documentation. To run the discovery:

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
