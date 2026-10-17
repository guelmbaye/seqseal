# Ring Developer Playground observations

This sheet records what the live Ring API returns for the account used in the demo. It grounds the bindings and mappings in observed data instead of assumptions.

**Status: not yet captured.** This build was produced without a Playground token, so every section below is empty on purpose. Do not fill it from documentation; fill it from `fixtures/ring/spike-<timestamp>/` after running:

```bash
export RING_PLAYGROUND_TOKEN=…        # one-click Playground token, never written to disk
pnpm tsx scripts/ring-spike.ts discover
```

## 1. Session

| Field | Value |
|---|---|
| Date (UTC) | |
| API base URL used | (default `https://api.amazonvision.com`, or `RING_API_BASE_URL`) |
| Token lifetime observed | |
| Spike folder | `fixtures/ring/spike-…/` |

## 2. Devices (`GET /v1/devices?include=status,capabilities,location,configurations`)

| Device id | Kind / model | Components | Status | Capabilities relevant to SEQSEAL |
|---|---|---|---|---|
| | | | | |

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
