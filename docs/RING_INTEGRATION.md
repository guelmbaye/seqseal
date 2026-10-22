# Ring integration

Ring is SEQSEAL's source of physical observations. SEQSEAL consumes what Ring reports (motion, vehicles, packages, button presses, device health) and never infers business meaning inside the adapter: a Ring event becomes a workflow state only through an explicit source binding and evidence mapping (`config/inbound-delivery.sources.yaml`).

Code: `packages/ring-adapter`. Ring developer documentation used:

- Notifications (webhooks, signatures): https://developer.amazon.com/docs/ring/notifications.html
- Motion detection events: https://developer.amazon.com/docs/ring/motion-detection.html
- API reference: https://developer.amazon.com/docs/ring/api-reference.html
- API documentation and getting started: https://developer.amazon.com/docs/ring/api-documentation.html, https://developer.amazon.com/docs/ring/get-started.html

## 1. Source profiles

Every observation carries the profile it came from, and the UI always shows it. A fixture is never labelled as live Ring data.

| Profile | Origin | Used for |
|---|---|---|
| `RING_WEBHOOK` | signed Ring notification to `/integrations/ring/webhook` | production path |
| `RING_STAGING` | the same webhook path against a staging Ring app | integration testing |
| `RING_PLAYGROUND` | Ring Developer Playground capture with a real Ring API call | live demo without a production app |
| `RING_DERIVED_REPLAY` | saved Ring captures (Playground sessions or webhook envelopes) replayed later through the full pipeline | demo fallback level 2 |
| `FIXTURE_REPLAY` | hand-written Ring-shaped test fixtures replayed through the full pipeline | local demo, benchmark, tests |
| `CUSTOM_MEDIA` | non-Ring demo media | labelled "not Ring"; never presented as Ring evidence |

## 2. Webhook path (`RING_WEBHOOK`, `RING_STAGING`)

Endpoint: `POST /integrations/ring/webhook` (Lambda `ring-ingest` on AWS, a Next.js route locally).

1. **Authenticate the raw bytes.** Ring signs the request body with HMAC-SHA256 and sends `X-Signature: sha256=<hex>`. SEQSEAL verifies over the raw body (never re-serialized JSON) with a constant-time comparison. On a mismatch, the request is rejected with 401 and logged as `ring_signature_rejected`, and nothing is stored or published (benchmark B11). The signing key lives in Secrets Manager on AWS and in `RING_WEBHOOK_SIGNING_SECRET` locally.
2. **Parse the JSON:API envelope.** The envelope has two parts:
   - `meta`: `version`, `time` (send time), `request_id`, `account_id`.
   - `data`: `id`, `type`, `subType`, and `attributes` (`source` device id, `source_type`, `timestamp` epoch ms, `component_ids`).
   Unknown fields are preserved; they are not dropped or interpreted.
3. **Deduplicate twice.**
   - `delivery:<profile>:<meta.request_id>` stops redelivery of the same request.
   - `event:<profile>:<data.id>` stops a re-sent event.
   Both keys have a TTL (`expires_at`) in the idempotency table.
4. **Classify** the event family:
   - Physical: `motion_detected`, `button_press`, `live_view_simulation`. These may become evidence.
   - Integration health: `device_online`/`offline`/`added`/`removed`, `app_integration_removed`, `media_unreadable`. These feed source coverage and never become evidence.
   - Unknown: stored, never interpreted (B10).
5. **Time.** `occurred_at` is `attributes.timestamp` when present (precision 1 s). Otherwise the envelope send time is used with ±30 s precision and flagged. The engine refuses to order two events whose uncertainty windows overlap (B25).
6. **Publish** `RingSourceEventReceived`. Everything after that is source-agnostic.

`motion_detected.subType` is an open vocabulary (`human`, `vehicle`, `package_delivery`, `other_motion`, `motion`, …). It is a signal, never a business state.

Test the production path against any deployment:

```bash
pnpm sign-webhook --url https://<api>/integrations/ring/webhook --secret <signing-key> \
  --device ring-device-staging --type motion_detected --subtype package_delivery --at 2026-10-18T14:03:00Z
```

## 3. Developer Playground path (`RING_PLAYGROUND`)

The Ring Developer Playground offers simulated live-view sources (Package, Vehicle, Motion) behind real Ring API calls, with a short-lived token. It is **not** a webhook simulator, so SEQSEAL does not fabricate `motion_detected.package_delivery` events from it. Instead, a **capture** records:

- `simulation_source` (`PACKAGE` | `VEHICLE` | `MOTION`) and the `session_zone` the operator declared for that session;
- `ring_event`: the Ring history event the simulation produced (id, type, start and end). It is read from `GET /v1/history/devices/{id}/events` right after the simulation. The Ring event id becomes the source event reference, `start` the physical time, and `end` is kept; capturing the same event twice gives one observation. Observed shape: JSON:API `data[]` of `history-events` items with `attributes.event_type: "on_demand"` and `start` / `end` in epoch ms ([ring-playground-observations.md](ring-playground-observations.md) §3);
- the capture takes the newest history event only if no saved session captured it already and it ended less than 180 s ago (`--max-age`). Until the new simulation's event is listed, the newest one may still belong to the previous step or delivery;
- one session is one delivery: the same simulation in the same zone twice in a session is refused (`--again` overrides), because it would put two Arrivals, or two Stagings, in one delivery;
- with `--post`, the lane is checked before Ring is called: SEQSEAL holds one open delivery per lane, so the command refuses an Arrival while a delivery is open, any other step when none is open, a new session that does not start with an Arrival, and a source/zone pair that maps to no step (`--force` overrides; BUILD_NOTES BN-026);
- the command waits up to 90 s (`--wait`) for the event: click the simulation first, then run it. Ring lists the event at about the end of the clip;
- `run --delivery A|B` chains the five steps of a delivery: it prints which simulation to click and takes only an event that started after that instruction. Every step is bound to a Ring event, and the run ends with SEQSEAL's verdict and action. An interrupted run resumes where it stopped (BUILD_NOTES BN-027);
- the history is read page by page (`links.next`, up to 5 pages), and the capture cites the call that returned the event. `--require-event` refuses a capture when no new event is found, instead of falling back to a status probe;
- the evidence drawer shows what Ring actually supplied for each Playground step: "Ring history event" or "Ring API call only", and whether the time is the Ring event's start or the capture time;
- `api_evidence`: the Ring API call actually made (method, endpoint, HTTP status, request id, response excerpt). A capture without a 2xx Ring call is refused, so no provenance is invented. If no new history event appears within 60 s, the capture falls back to a status probe and records that;
- optional `device_id`, `component_id`, `media_session_ref`.

The observation type is `live_view_simulation`; the Ring event type (for example `on_demand`) is kept in its attributes. Bindings `BIND-PG-*` match on the declared `session_zone`, and mappings `MAP-PG-*` map VEHICLE / PACKAGE / MOTION in that zone to a state. The evidence drawer discloses that the source and the zone were declared by the operator.

**Who decides what.** The operator binds each newly captured Playground event to its simulation and dock zone, because the Playground does not classify the footage. The operator never chooses the verdict or the action: the sequence verification, and then RELEASE or HOLD, are computed automatically from the captured Ring event timestamps.

```bash
RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts discover
RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts history --device <id>   # what Ring's history lists right now
# a whole delivery, guided: the command says which simulation to click for each step
RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts run --device <id> --post http://localhost:3000 --delivery A
# click a simulation in the Playground, wait for it to finish, then:
RING_PLAYGROUND_TOKEN=… pnpm tsx scripts/ring-spike.ts capture --device <id> --source PACKAGE --zone staging \
  --session demo-a --post http://localhost:3000 [--token <demo-token>] [--again] [--wait <s>] [--max-age <s>] [--require-event]
```

Every capture is also appended to `fixtures/ring/captures/<session>.jsonl`. Such a session can be replayed later through the normal pipeline, labelled `RING_DERIVED_REPLAY`:

- from the Monitor page;
- with `pnpm replay --captures fixtures/ring/captures/<session>.jsonl [--remote <api>]`. The token comes from `SEQSEAL_DEMO_TOKEN`; avoid `--token`, because pnpm prints the command line.

`discover` calls `GET /v1/users/me`, `GET /v1/devices?include=status,capabilities,location,configurations` and, per device, status, capabilities, configurations and event history. It writes the redacted responses to `fixtures/ring/spike-<timestamp>/`. The token is read from the environment and never written to disk. Record the findings in [ring-playground-observations.md](ring-playground-observations.md).

## 4. Ring API client

`RingApiClient` (`packages/ring-adapter/src/api-client.ts`) wraps the documented partner endpoints:

```
GET  /v1/users/me
GET  /v1/devices?include=status,capabilities,location,configurations
GET  /v1/devices/{id} · /status · /capabilities · /configurations   (?component_id=N)
GET  /v1/history/devices/{id}/events
POST /v1/devices/{id}/media/image/download
POST /v1/devices/{id}/media/video/download
POST /v1/devices/{id}/media/streaming/whep/sessions      (application/sdp)
```

The base URL defaults to `https://api.amazonvision.com` (`RING_API_BASE_URL`). Each call logs method, path, status, duration, `x-request-id` and rate-limit headers, and non-2xx responses raise `RingApiError` with `retry-after`. Media download is only used by the optional media interpreter.

## 5. From observation to evidence

```
observation (device or session_zone) ──binding──► logical zone
logical zone + event type/subtype     ──mapping──► candidate state (mode)
candidate                             ──acceptance policy──► Evidence | UNCERTAIN | REJECTED
```

To deploy on a real site, replace the placeholder device refs (`ring-device-entry`, `ring-device-staging`, `ring-device-storage`, `ring-device-exit`) with the ids returned by `GET /v1/devices`. `validateSourceConfigAgainstProtocol` refuses a configuration that maps to a state or zone the protocol does not declare.

Current IDP-01 mappings:

| Mapping | Zone | Ring signal | State | Mode |
|---|---|---|---|---|
| MAP-ARRIVAL | receiving-entry | motion_detected / vehicle | ARRIVAL | CONFIGURED_MAPPING |
| MAP-STAGING | staging | motion_detected / package_delivery, human, motion | STAGING | CONFIGURED_MAPPING |
| MAP-STAGING-AI | staging | motion_detected / other_motion | STAGING | AI_ASSISTED |
| MAP-STORAGE | storage-transition | motion_detected / human, motion, package_delivery | STORAGE | CONFIGURED_MAPPING |
| MAP-DEPARTURE | receiving-exit | motion_detected / vehicle | DEPARTURE | CONFIGURED_MAPPING |
| MAP-CLEAR | receiving-exit | button_press | CLEAR | CONFIGURED_MAPPING |
| MAP-PG-ARRIVAL | receiving-entry (declared) | live_view_simulation / VEHICLE | ARRIVAL | CONFIGURED_MAPPING |
| MAP-PG-STAGING | staging (declared) | live_view_simulation / PACKAGE | STAGING | CONFIGURED_MAPPING |
| MAP-PG-STORAGE | storage-transition (declared) | live_view_simulation / MOTION, PACKAGE | STORAGE | CONFIGURED_MAPPING |
| MAP-PG-DEPARTURE | receiving-exit (declared) | live_view_simulation / VEHICLE | DEPARTURE | CONFIGURED_MAPPING |
| MAP-PG-CLEAR | receiving-exit (declared) | live_view_simulation / MOTION | CLEAR | CONFIGURED_MAPPING |

## 6. Account lifecycle

- `app_integration_removed` marks the source `ACCESS_REVOKED`.
- `device_offline` opens a coverage gap for that zone, so any execution relying on it becomes UNCERTAIN → REVIEW, not INCOMPLETE and never DEVIATED (B08).
- Tokens (`RING_PLAYGROUND_TOKEN`, OAuth client credentials) are environment or Secrets Manager values only.
