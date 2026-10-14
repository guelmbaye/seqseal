# Friction log

Only friction actually encountered while building SEQSEAL is recorded here. Nothing is hypothetical.

**Scope of this build.** The code was written and verified in a sandboxed environment that had no Ring Developer Playground token, no AWS credentials, and outbound network limited to package registries. Consequently:

- no live Ring API call and no AWS deployment were performed here;
- there are no Ring or AWS entries yet;
- entries from the live Ring spike and the first `terraform apply` must be added when those steps run (template at the end).

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
