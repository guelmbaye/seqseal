# Ring Developer Playground observations

This sheet records what the live Ring API returns for the account used in the demo. It grounds the bindings and mappings in observed data instead of assumptions.

**Status: discovery done (2026-10-18), captures pending.** Fill the rest from `fixtures/ring/spike-<timestamp>/`, never from documentation. To run the discovery:

```bash
export RING_PLAYGROUND_TOKEN=…        # one-click Playground token, never written to disk
pnpm tsx scripts/ring-spike.ts discover
```

## 1. Session

| Field | Value |
|---|---|
| Date (UTC) | 2026-10-18 08:47 |
| API base URL used | `https://api.amazonvision.com` (default) |
| Token lifetime observed | Not yet confirmed. The token was refused with 401 about 11 min after a successful discovery (FRICTION_LOG FL-005); the script now prints the token's expiry |
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

One device was returned:

| Device id | Kind / model | Components | Status | Capabilities relevant to SEQSEAL |
|---|---|---|---|---|
| `ava1.ring.device.DJXHOX5NRJIDNGWFTA74YI45P4WJGLK6GPLAWU7HA7YHPDVQ4LRHUL2J4ZZK6FUOLZPKQSHJKXRNK2VYXYIPD4N5ZJIKO3RA` | to fill from `devices.json` | | | |

## 3. Event history (`GET /v1/history/devices/{id}/events`)

| Device | Event types seen | `subType` values seen | Physical timestamp present? | Notes |
|---|---|---|---|---|
| | | | | |

## 4. Simulated sources (Package, Vehicle, Motion)

| Source | API calls made | HTTP status | Request id | What the response contains |
|---|---|---|---|---|
| PACKAGE | | | | |
| VEHICLE | | | | |
| MOTION | | | | |

## 5. Consequences for SEQSEAL configuration

After filling sections 2–4:

- **Bindings.** Record the real device ids replacing `ring-device-entry`, `ring-device-staging`, `ring-device-storage` and `ring-device-exit` in `config/inbound-delivery.sources.yaml`.
- **Mappings.** Note any mapping that must change because a `subType` is never returned, or a new one appears.
- **Precision.** Note whether physical timestamps are present (if not, the ±30 s fallback applies; see BUILD_NOTES BN-004).
- **Friction.** Any friction goes into [FRICTION_LOG.md](FRICTION_LOG.md).

## 6. Captures used in the demo

```bash
pnpm tsx scripts/ring-spike.ts capture --device <id> --source VEHICLE --zone receiving-entry --post http://localhost:3000
pnpm tsx scripts/ring-spike.ts capture --device <id> --source PACKAGE --zone staging --post http://localhost:3000
pnpm tsx scripts/ring-spike.ts capture --device <id> --source MOTION  --zone storage-transition --post http://localhost:3000
pnpm tsx scripts/ring-spike.ts capture --device <id> --source VEHICLE --zone receiving-exit --post http://localhost:3000
pnpm tsx scripts/ring-spike.ts capture --device <id> --source MOTION  --zone receiving-exit --post http://localhost:3000
```

Each capture is saved to `fixtures/ring/captures/<session>.jsonl` and can be replayed later as Ring-derived replay.

| Capture id | Ring event id (type) | Source | Declared zone | Ring request id | Resulting evidence | Execution |
|---|---|---|---|---|---|---|
| | | | | | | |

Record whether the history event appeared, how long after the simulation, and what its timestamp field was called. `latestHistoryEvent` in `packages/ring-adapter/src/playground.ts` is tolerant on purpose; tighten it once the shape is known.
