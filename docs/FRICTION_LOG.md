# Friction log

Only friction actually encountered while building SEQSEAL is recorded here. Nothing is hypothetical.

**Where each entry comes from.** The code was written and verified in a sandboxed environment without Ring or AWS access. The tooling entries (FL-001 to FL-004) come from that build. The Ring entries come from the live runs on the developer's machine (FL-005 to FL-007, FL-009). The AWS entry comes from the deployment of 2026-10-21 (FL-008).

Entry format: Date · Tool / API · Task · Steps · Expected · Actual · Severity (Critical / Major / Minor / Cosmetic) · Impact · Workaround · Suggested improvement · Status.

---

## FL-001 — Turbopack traces the whole monorepo from a workspace package

| | |
|---|---|
| Date | 2026-10-14 |
| Tool | Next.js 16.4.0 (Turbopack build) |
| Task | Build the web app, which imports the pipeline package and its configuration loader |
| Steps | `next build` in `apps/web`. The loader in `packages/pipeline/src/config-loader.ts` walks up from `process.cwd()` to find `protocols/`. |
| Expected | A build that bundles only the routes' dependencies |
| Actual | Warning: "Dynamic filesystem access causes tracing of the whole project", pointing at `resolve(start)` |
| Severity | Minor |
| Impact | The server output would include every source file of the monorepo, inflating deployments |
| Workaround | `resolve(/* turbopackIgnore: true */ start)`; configuration is read at runtime from `SEQSEAL_CONFIG_DIR` or the repository root |
| Suggested improvement | Name the offending import chain in the warning's first line; it is only shown in the trace below |
| Status | Resolved |

## FL-002 — The same package type-checks under Node but not under the web app's DOM lib

| | |
|---|---|
| Date | 2026-10-14 |
| Tool | TypeScript 5.9.3 with `@types/node` 22 and the DOM lib |
| Task | Type-check the Next.js app, which transitively includes the Ring API client |
| Steps | `tsc --noEmit` in `apps/web` (lib `dom`) after the root project (Node only) passed |
| Expected | Same result in both projects |
| Actual | `Uint8Array<ArrayBufferLike>` is not assignable to `BodyInit` in `fetch(…, { body })` |
| Severity | Minor |
| Impact | The web typecheck failed on code it never runs (the Ring API client runs in Lambdas and scripts) |
| Workaround | Narrowed the request body type to `string`, the only type actually sent |
| Suggested improvement | Not a defect as such; worth a note in monorepo docs that DOM and Node `fetch` typings diverge on binary bodies |
| Status | Resolved |

## FL-003 — Root scripts cannot import workspace packages unless declared

| | |
|---|---|
| Date | 2026-10-14 |
| Tool | pnpm 10.28 workspaces |
| Task | Run `tsx benchmarks/run.ts` and `tsx scripts/*.ts` from the repository root |
| Steps | Packages declared in `pnpm-workspace.yaml`; scripts import `@seqseal/pipeline` |
| Expected | Workspace packages resolvable from root scripts |
| Actual | `ERR_MODULE_NOT_FOUND` until each package was added to the root `devDependencies` as `workspace:*` |
| Severity | Minor |
| Impact | About 10 minutes |
| Workaround | Root `devDependencies` list every workspace package |
| Suggested improvement | None; this is pnpm's strict isolation working as designed |
| Status | Resolved |

## FL-004 — Package `bin` pointing at a build output warns on install

| | |
|---|---|
| Date | 2026-10-14 |
| Tool | pnpm 10.28 |
| Task | Expose the `pwps` CLI from `@pwps/core` |
| Steps | `bin: dist/cli.js`, then `pnpm install` before any build |
| Expected | Silent install |
| Actual | Warning that the bin target does not exist |
| Severity | Cosmetic |
| Impact | Noise on every fresh clone |
| Workaround | Committed launcher `packages/pwps/bin/pwps.mjs` that loads the built CLI and explains how to build it; inside the monorepo `pnpm pwps` runs the TypeScript source through tsx |
| Status | Resolved |

## FL-005 — Playground token refused about 11 minutes after a successful discovery

| | |
|---|---|
| Date | 2026-10-18 |
| Tool / API | Ring Developer Playground token · Ring API (`api.amazonvision.com`) |
| Task | Ring Source Spike: discovery, then the first Playground capture |
| Steps | 08:47 UTC: `ring-spike.ts discover` makes 6 calls, all HTTP 200 (`/v1/users/me`, `/v1/devices`, the device's `status`, `capabilities`, `configurations` and `history/…/events`). About 11 minutes later, in the same terminal and with the same token, `ring-spike.ts capture` gets HTTP 401 on `history/…/events` and on `status` |
| Expected | Same token valid for the whole capture session |
| Actual | HTTP 401 on every call, including the `status` endpoint that had answered 200 minutes earlier. The response body gave no reason |
| Severity | Major |
| Impact | Capture blocked until a new token is generated. With a short token lifetime, the ten captures of the Winning Moment (A then B) have to fit inside one token window, or be split |
| Workaround | Generate a new token right before capturing. The spike script now reads the token's `exp` claim locally, prints its expiry, refuses an expired token, and stops at the first 401/403 instead of retrying |
| Suggested improvement | Show the token expiry time next to Generate Token in the Playground, and return an explicit `token_expired` reason in the 401 body |
| Status | Resolved by workaround. The next token's `exp` claim gave about 30 minutes of validity (read at 09:05 UTC: valid until 09:34 UTC), consistent with the first token having expired between discovery and capture |

## FL-006 — A Playground history event does not say which simulation produced it

| | |
|---|---|
| Date | 2026-10-18 |
| Tool / API | Ring Developer Playground · `GET /v1/history/devices/{id}/events` |
| Task | Ring Source Spike: bind each capture to the Ring event of the simulation just clicked |
| Steps | 16:21 and 16:22 UTC: click Vehicle in the Playground, wait for the end, run `ring-spike.ts capture --source VEHICLE`. Each run reads the device's event history |
| Expected | Something in the event naming the simulated source: a vehicle entry in `cv_detections`, or a field saying "vehicle" |
| Actual | Both events: `event_type: "on_demand"`, `relationships.cv_detections.data: []`, attributes `start`, `end`, `is_third_party_reviewed` only. HTTP 200, request ids `a38ea6fb-5ca2-48e9-8ee6-b5717d590ad8` and `3ac0abbb-9241-4711-9e74-0c0e2a891bc7` |
| Severity | Minor |
| Impact | Ring proves that a simulation ran on the device, and when. It does not prove which one ran. The source (VEHICLE, PACKAGE, MOTION) must be declared by the operator with `--source`, and the evidence drawer says so |
| Workaround | None needed. The operator-declared source and zone were already the design (BUILD_NOTES BN-003) |
| Suggested improvement | Populate `cv_detections` for Playground simulations with the class that was shown (vehicle, package, person), as a real camera would |
| Status | Open. Confirmed for VEHICLE, PACKAGE and MOTION: every event seen, including the ten of the 2026-10-19 live run, has `event_type: on_demand` and an empty `cv_detections`. Each simulation has its own clip length (Vehicle 21.76 s, Package 31.7 s, Motion 39.71 s), which identifies the Playground footage but is not a Ring classification |

## FL-007 — Event history calls sometimes take 10 s or more

| | |
|---|---|
| Date | 2026-10-18 |
| Tool / API | Ring API · `GET /v1/history/devices/{id}/events` |
| Task | Poll the device's history every 5 s while a Playground simulation plays |
| Steps | `ring-spike.ts history` at 17:38:32 UTC, then `capture` at 17:39 and 17:50, with a 10 s client timeout per call |
| Expected | Latency close to the 871 ms measured at discovery |
| Actual | 9 787 ms for one call (request id `2fc36400-fb53-4e2f-bc87-4314151c7aff`). Three other calls were still unanswered after 10 s and were aborted by the client. Later calls in the same polls answered normally |
| Severity | Minor |
| Impact | A capture could miss its event until the next poll, and the abort message looked like a failure |
| Workaround | The capture waits 25 s per call, says "Ring did not answer within 25 s; asking again", and keeps polling |
| Suggested improvement | Document the expected latency of the history endpoint, or offer a `since` filter so polls stay small |
| Status | Resolved by workaround |

## FL-008 — Missing AWS credentials reported as an EC2 metadata network error

| | |
|---|---|
| Date | 2026-10-21 |
| Tool / API | Terraform AWS provider (~> 5.80) on Windows 11, PowerShell |
| Task | First `terraform plan` of the demo environment, on a laptop where no AWS credentials were configured yet |
| Steps | `terraform plan -out tfplan` in `infrastructure/terraform/environments/demo` |
| Expected | A message saying that no AWS credentials or profile are configured, and how to set one |
| Actual | "No valid credential sources found", followed by "failed to refresh cached credentials, no EC2 IMDS role found … dial tcp 169.254.169.254:80 … network unreachable". The second error points at EC2 instance metadata, which does not exist on a laptop |
| Severity | Cosmetic |
| Impact | Time spent looking for a network problem, when the cause was simply the missing credentials |
| Workaround | Configure a profile (`aws configure` or `aws configure sso`), set `AWS_PROFILE`, and check with `aws sts get-caller-identity` before `terraform plan` |
| Suggested improvement | When no credential source is found outside EC2, skip the IMDS detail or list the sources tried (environment, shared config, SSO) with the command to configure one |
| Status | Resolved |

## FL-009 — The API cannot choose which Playground simulation plays

| | |
|---|---|
| Date | 2026-10-19 |
| Tool / API | Ring Developer Playground · Ring API live view (WHEP session) |
| Task | Drive a whole delivery (five steps alternating Vehicle, Package and Motion) from a script, without a person clicking in the Playground |
| Steps | Looked for a way to start a chosen simulation from the API. The API can open a live view (WHEP session) on the Playground device, but Package, Vehicle or Motion is chosen on the Playground page |
| Expected | A request parameter, or an endpoint, that starts a chosen simulation |
| Actual | No documented request parameter selects the simulated source. Each step needs one click in the Playground page |
| Severity | Minor |
| Impact | Every live delivery needs an operator clicking at the right moment. Before the guided command, runs had a step captured twice, a step captured before its click, and a session started without an Arrival (BUILD_NOTES BN-027) |
| Workaround | `ring-spike.ts run --delivery A\|B` prints which simulation to click for each step and only accepts a Ring event that started after the instruction |
| Suggested improvement | Let a Playground endpoint, or the live-view request, take the simulated source (`PACKAGE`, `VEHICLE`, `MOTION`), so that a delivery can be scripted and repeated in CI |
| Status | Open; worked around |

---

## Template for the live Ring spike and AWS deployment

Run `scripts/ring-spike.ts discover` and `capture` (see [RING_INTEGRATION.md](RING_INTEGRATION.md)), then `terraform apply` (see `infrastructure/terraform/README.md`), and record each real difficulty:

```
## FL-0xx — <short title>
| Date | |
| Tool / API | Ring Developer Playground · Ring API <endpoint> · Ring webhooks · Amazon Bedrock · AWS Lambda · EventBridge/SQS · Terraform |
| Task | |
| Steps | |
| Expected | |
| Actual | (HTTP status, request id, exact message) |
| Severity | Critical / Major / Minor / Cosmetic |
| Impact | |
| Workaround | |
| Suggested improvement | |
| Status | Open / Resolved / Reported |
```

Categories worth watching:

- Playground token lifetime;
- device and component discovery;
- motion `subType` values actually returned;
- event history availability;
- media readiness;
- webhook registration and signature key rotation;
- Bedrock tool-use structured output;
- Lambda bundle size.
