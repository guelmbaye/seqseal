# SEQSEAL — Terraform infrastructure

Serverless, event-driven AWS deployment of the SEQSEAL pipeline
(Ring source event → evidence → deterministic verdict → operational action → sealed receipt).

```
Ring webhook ─┐                                  ┌─ read-api / review-api / demo-orchestrator
Playground  ──┤► API Gateway HTTP API (v2) ──────┤
              └► ring-ingest / ring-playground-adapter
                          │ PutEvents (Source "seqseal", DetailType = event_type)
                          ▼
              EventBridge bus  <prefix>-events  (+ 7-day archive)
                          │ rules by detail-type (retry 10x / 1h, DLQ <prefix>-eventbridge-dlq)
                          ▼
   ring-observation-q ► observation-normalizer        operational-decision-q ► policy-evaluator
   evidence-resolution-q ► evidence-resolver          operational-gate-q     ► operational-gate
   media-interpretation-q ► media-interpreter         receipt-generation-q   ► receipt-generator
   protocol-evaluation-q ┐
   finalization-q (delay)┴► sequence-evaluator        execution-sweeper ◄ rate(5 minutes)
```

Every work queue has its own `<queue>-dlq` (maxReceiveCount 5). All functions are
`nodejs22.x` / `arm64`, X-Ray active, with a dedicated least-privilege IAM role.

## Layout

```
infrastructure/terraform/
  versions.tf  variables.tf  main.tf  outputs.tf   root module (no provider block)
  modules/
    secrets/     KMS CMK alias/<prefix> (rotation on) + 3 Secrets Manager containers
    dynamodb/    executions, evidence, config, idempotency (TTL expires_at)
    s3/          <prefix>-artifacts-<account_id> (versioned, SSE-KMS, TLS-only)
    queues/      8 work queues + 8 DLQs (SSE-SQS)
    event-bus/   bus, archive, routing rules -> SQS, queue policies, EventBridge DLQ
    iam/         one role per Lambda (authority table below)
    lambdas/     functions, log groups, SQS event source mappings, sweeper schedule
    api/         HTTP API, routes, AWS_PROXY integrations, $default stage, permissions
    monitoring/  DLQ + Lambda error alarms, optional SNS e-mail, dashboard
  environments/
    dev/   main.tf, terraform.tfvars.example, backend.tf.example
    demo/  main.tf, terraform.tfvars.example, backend.tf.example
```

`<prefix>` is `${project}-${environment}`, e.g. `seqseal-dev`.

## 1. Build the Lambda bundles

Terraform reads the bundles at **plan** time (`filebase64sha256`), so build first:

```bash
pnpm install
pnpm build:lambdas     # -> services/<name>/dist/<name>.zip for all 13 functions
```

Each zip must contain `index.js` exporting `handler`, and the `seqseal-config/`
directory (copies of `protocols/`, `policies/`, `config/`) — functions read it
through `SEQSEAL_CONFIG_DIR=/var/task/seqseal-config`.

`lambda_artifacts_dir` (default `../../services`) is resolved **relative to
`infrastructure/terraform`** (the root module directory), so the default works
from any environment directory. Absolute paths are used as-is, e.g.
`-var lambda_artifacts_dir=$PWD/services`.

## 2. Deploy an environment

```bash
cd infrastructure/terraform/environments/dev        # or demo
cp terraform.tfvars.example terraform.tfvars        # optional overrides (git-ignored)
cp backend.tf.example backend.tf                    # optional: S3 remote state (edit bucket)

terraform init
terraform plan -out tfplan
terraform apply tfplan
terraform output
```

| | dev | demo |
|---|---|---|
| DynamoDB deletion protection | off | **on** |
| Secrets recovery window | 0 (force delete) | 7 days |
| KMS deletion window | 7 days | 30 days |
| Artifact bucket `force_destroy` | true | false |

Credentials come from the standard AWS chain (`AWS_PROFILE`, SSO, env vars).
The provider (region + `default_tags`) lives in `environments/<env>/main.tf`; the
root module has only `required_providers`, so it can be reused as a module.

Useful variables: `aws_region`, `log_retention_days` (14), `finalization_grace_seconds`
(5, also the `finalization-q` delay), `execution_horizon_minutes` (30),
`enable_bedrock_evidence` (false), `bedrock_model_id` (""), `web_allowed_origins`,
`alarm_email` ("" = no SNS topic), `demo_mode` (true).

## 3. Set the secret values

Terraform creates the secret **containers** only — values never enter Terraform
state. Set all three right after the first apply. Until a secret has a value, the endpoints
that need it refuse requests (401 or 503) instead of crashing:

- **ring-webhook-signing-secret**: from the Ring app settings. If you only use the Playground (no webhooks), set a random value.
- **ring-api-token**: only used for server-side snapshot captures. A Playground token (valid for 30 minutes) or any placeholder will do.
- **demo-token**: a random value, sent as `x-seqseal-demo-token`. The scripts and the web console read it from `SEQSEAL_DEMO_TOKEN`; never pass it with `--token`, because pnpm prints the command line.

bash:

```bash
P=seqseal-dev   # or seqseal-demo
REGION=us-east-1

# Ring webhook HMAC signing secret (from the Ring Developer Platform app settings)
aws secretsmanager put-secret-value --region $REGION \
  --secret-id "$P/ring-webhook-signing-secret" --secret-string '<signing-secret>'

# Ring Developer Playground / partner API bearer token
aws secretsmanager put-secret-value --region $REGION \
  --secret-id "$P/ring-api-token" --secret-string '<bearer-token>'

# Shared demo token, sent as the x-seqseal-demo-token header on demo/review endpoints
aws secretsmanager put-secret-value --region $REGION \
  --secret-id "$P/demo-token" --secret-string "$(openssl rand -hex 32)"
```

PowerShell (Windows):

```powershell
$P = "seqseal-demo"; $R = "us-east-1"
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") }) }
$DEMO = New-Secret
aws secretsmanager put-secret-value --region $R --secret-id "$P/ring-webhook-signing-secret" --secret-string (New-Secret)
aws secretsmanager put-secret-value --region $R --secret-id "$P/ring-api-token" --secret-string "placeholder-not-used"
aws secretsmanager put-secret-value --region $R --secret-id "$P/demo-token" --secret-string $DEMO
```

`$DEMO` is never written to disk. In a new shell, read the token back from Secrets Manager
instead of copying it:

```powershell
$env:SEQSEAL_DEMO_TOKEN = aws secretsmanager get-secret-value --region us-east-1 --secret-id seqseal-demo/demo-token --query SecretString --output text
```

The ARNs are also available as `terraform output secret_arns`.

### Rotate the demo token

Rotate it whenever it may have been seen (a terminal shared on screen, a pasted log):

```powershell
function New-Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") }) }
aws secretsmanager put-secret-value --region us-east-1 --secret-id seqseal-demo/demo-token --secret-string (New-Secret)
$env:SEQSEAL_DEMO_TOKEN = aws secretsmanager get-secret-value --region us-east-1 --secret-id seqseal-demo/demo-token --query SecretString --output text
```

The functions cache secrets for 5 minutes, so the new token is accepted everywhere within
5 minutes, or at once after a redeploy. Restart the web console: it reads `SEQSEAL_DEMO_TOKEN`
when it starts.

## 4. Wire it up

- **Ring webhook**: register `terraform output -raw webhook_url`
  (`POST /integrations/ring/webhook`).
- **Web console**: `SEQSEAL_BACKEND=remote`, `SEQSEAL_API_URL=$(terraform output -raw api_endpoint)` and
  `SEQSEAL_DEMO_TOKEN`, then `pnpm --filter @seqseal/web start` after `pnpm build` (§5).
- **Dashboard**: CloudWatch → Dashboards → `<prefix>-source-to-action`.

| Route | Function |
|---|---|
| `POST /integrations/ring/webhook` | ring-ingest |
| `POST /integrations/ring/playground/capture` | ring-playground-adapter |
| `GET /api/{proxy+}` | read-api |
| `POST /api/reviews` | review-api |
| `POST /api/demo/{proxy+}` | demo-orchestrator |

The stage throttles at burst 50 / rate 25 rps. CORS allows `GET, POST, OPTIONS` and
headers `content-type`, `x-seqseal-demo-token`.

## 5. Check the deployment end to end

PowerShell, from the repository root:

```powershell
$API = terraform -chdir=infrastructure/terraform/environments/demo output -raw api_endpoint
Invoke-RestMethod "$API/api/status"                                   # backend aws:demo, protocol IDP-01@1.0.0

# The scripts read the demo token from this variable. Do not pass it with --token:
# pnpm prints the full command line, token included.
$env:SEQSEAL_DEMO_TOKEN = aws secretsmanager get-secret-value --region us-east-1 --secret-id seqseal-demo/demo-token --query SecretString --output text

# The live Ring sessions of 2026-10-19, replayed on AWS (Ring-derived replay)
pnpm replay --captures fixtures/ring/captures/live-2026-10-19-a.jsonl --remote $API
pnpm replay --captures fixtures/ring/captures/live-2026-10-19-b.jsonl --remote $API
Start-Sleep 30
(Invoke-RestMethod "$API/api/status").counts | ConvertTo-Json -Compress
# expected on a fresh deployment: {"executions":2,"receipts":2,"observations":10}
$ex = Invoke-RestMethod "$API/api/executions"                         # assign first: Windows PowerShell 5.1 does not unroll JSON arrays in a pipeline
$ex | Format-Table execution_id, verdict, action, workflow_status, source_profiles
# expected: one SEALED / RELEASE / RELEASED and one DEVIATED / HOLD / HELD
$r = Invoke-RestMethod "$API/api/receipts"
$r | Format-Table receipt_id, execution_id, receipt_version, verdict, operational_action
# expected: exactly one receipt (version 1) per execution

# The web console on the AWS backend. Build it once (next start serves the last build);
# the backend is chosen when the server starts, from these variables.
pnpm build
$env:SEQSEAL_BACKEND = "remote"; $env:SEQSEAL_API_URL = $API          # SEQSEAL_DEMO_TOKEN is already set
pnpm --filter @seqseal/web start                                       # http://localhost:3000, System page: "Backend: aws:demo"
```

The console calls the API from its own server, so no browser origin needs to be allowed
for it (`web_allowed_origins` is only for pages that call the API from the browser).

Then check:

- **Monitoring.** In CloudWatch, the `<prefix>-source-to-action` dashboard shows invocations and no errors, and every DLQ alarm is OK.
- **Live run.** With the console started on the AWS backend, keep `--post http://localhost:3000`: the console forwards each capture to the API with the demo token, and the API address never appears in the terminal. Posting straight to the API also works: `--post $API` (the token comes from `SEQSEAL_DEMO_TOKEN`).
- **Replays through the console.** `pnpm replay --captures … --remote http://localhost:3000` keeps the Ring-derived replay label on AWS: the console forwards the provenance headers.
- **What differs on AWS.**
  - **Clear results** only closes active demo executions; history stays.
  - The Monitor's "Replay Ring-derived session" buttons are not offered: use `pnpm replay --remote`.
  - Execution and receipt numbers continue from earlier runs.
- **Problems.** Record every real difficulty in `docs/FRICTION_LOG.md`.

## 6. Tear down

The demo environment protects its data: DynamoDB deletion protection, a versioned artifact bucket, a 7-day
recovery window on secrets and a 30-day window on the KMS key. Remove those protections in one apply, then destroy:

```powershell
cd infrastructure\terraform\environments\demo
terraform apply -var teardown=true      # in place only; expect "0 to add, ... to change, 0 to destroy"
terraform destroy -var teardown=true    # removes every resource of the environment
```

- **The apply** changes the four tables (deletion protection off), the bucket (`force_destroy`, so its object
  versions are deleted with it), the three secrets (no recovery window) and the KMS key (7-day window). The Lambda
  functions may show as updated too if the bundles were rebuilt. If the plan adds or destroys anything, stop.
- **After the destroy**, the KMS key stays *Pending deletion* for 7 days and is then deleted; a key pending deletion
  is not billed. The secrets are deleted at once, so a later `terraform apply` can recreate them with the same names.
- **Check that nothing is left:**

  ```powershell
  aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=seqseal --region us-east-1 --query "ResourceTagMappingList[].ResourceARN"
  ```

  Only the key pending deletion should remain; the tagging API can also list a deleted resource for a short while.
- **Credentials.** Delete the access key Terraform used once you no longer need it (IAM → Users → Security credentials).

## IAM authority table

> **The Sequence Evaluator cannot invoke Bedrock: verdict authority is deterministic
> by IAM, not by prompt.**

The verdict, decision, action and receipt functions all carry an explicit
`Deny bedrock:*` on `*`. No later `Allow` can override it.

| Function | DynamoDB (tables) | Other |
|---|---|---|
| ring-ingest | Get/Put/Update/Query on idempotency, evidence, executions | PutEvents; GetSecretValue ring-webhook-signing-secret |
| ring-playground-adapter | Get/Put/Update/Query on idempotency, evidence, executions | PutEvents; GetSecretValue ring-api-token, demo-token; s3:PutObject `media/*` (snapshot captures) |
| observation-normalizer | Get/Put/Update/Query on idempotency, evidence, executions | PutEvents |
| evidence-resolver | Get/Put/Update/Query/Delete on evidence, executions, config | PutEvents |
| media-interpreter | Get/Put/Update/Query/Delete on evidence, executions, config | PutEvents; GetSecretValue ring-api-token; s3:GetObject and s3:PutObject `media/*`; bedrock:InvokeModel(+WithResponseStream) on foundation-model/* and inference-profile/* **only when `enable_bedrock_evidence = true`** |
| sequence-evaluator | Get/Put/Update/Query/Delete on executions, config; Get/Query on evidence | PutEvents; s3:PutObject `evaluations/*`; **Deny bedrock:\*** |
| policy-evaluator | Get/Put/Query on executions | PutEvents; **Deny bedrock:\*** |
| operational-gate | Get/Put/Update/Query on executions | PutEvents; **Deny bedrock:\*** |
| receipt-generator | Get/Put/Update/Query on executions; Get/Query on evidence, config | PutEvents; s3:PutObject `receipts/*`; **Deny bedrock:\*** |
| read-api | Get/Query on all four tables | s3:GetObject `receipts/*` |
| review-api | Get/Put/Update/Query on executions, evidence, config | PutEvents; GetSecretValue demo-token |
| demo-orchestrator | Get/Put/Update/Query/Delete on all four tables | PutEvents; GetSecretValue demo-token; s3:PutObject `evaluations/*` (finalize evaluates inline) |
| execution-sweeper | Get/Put/Update/Query/Delete on executions, config; Get/Query on evidence | PutEvents; s3:PutObject `evaluations/*` (finalize evaluates inline) |

Every role also gets the following:

- `logs:CreateLogStream` and `logs:PutLogEvents` on **its own** log group.
- `xray:PutTraceSegments` and `xray:PutTelemetryRecords`.
- `kms:Decrypt`, `kms:GenerateDataKey` and `kms:DescribeKey` on the project CMK. These only work through
  DynamoDB, S3 or Secrets Manager (`kms:ViaService`).
- DynamoDB grants cover `<table_arn>` and `<table_arn>/index/*`.
- An SQS consumer gets `ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes` and `ChangeMessageVisibility` on its own queue(s) only.
  sequence-evaluator consumes two queues: `protocol-evaluation-q` and `finalization-q`.
- `events:PutEvents` covers only the SEQSEAL bus.

The source of truth is `local.authority` in `modules/iam/main.tf`.

**Checked before deploying.** `packages/aws/test/aws-wiring.test.ts` reads these Terraform files as written: the routes, the queue consumers and this table. It runs every demo flow on the real pipeline, with each event delivered the way EventBridge and SQS deliver it. Every DynamoDB action, S3 object, PutEvents and secret is checked against the grants of the function that uses it. A missing grant there would be an AccessDenied on AWS. Only `ring-ingest` reads the webhook signing secret (`awsRuntime(…, { ringSigningSecret: true })`).

## Event routing

| detail-type | Queue → consumer |
|---|---|
| `seqseal.ring.source_event_received` | ring-observation-q → observation-normalizer |
| `seqseal.observation.normalized` | evidence-resolution-q → evidence-resolver |
| `seqseal.evidence.interpretation_requested` | media-interpretation-q → media-interpreter |
| `seqseal.evidence.accepted`, `.evidence.unresolved`, `.evidence.reviewed`, `.execution.correlation_ambiguity`, `.ring.source_health_changed` | protocol-evaluation-q → sequence-evaluator |
| `seqseal.execution.finalization_requested` | finalization-q (delay = `finalization_grace_seconds`) → sequence-evaluator |
| `seqseal.verification.completed` | operational-decision-q → policy-evaluator |
| `seqseal.operation.decision_created` | operational-gate-q → operational-gate |
| `seqseal.operation.action_applied` | receipt-generation-q → receipt-generator |

Each queue only accepts `sqs:SendMessage` from `events.amazonaws.com` when
`aws:SourceArn` is the rule that routes to it.

## Monitoring

- **DLQ alarms**: `ApproximateNumberOfMessagesVisible > 0` (60 s, 1 period) on all 8 DLQs and on the EventBridge DLQ.
- **Lambda alarms**: `Errors > 0` over 5 minutes for every function.
- **Notifications**: alarms go to an SNS topic with an e-mail subscription when `alarm_email` is set. You must confirm the subscription e-mail.
- **Dashboard** `<prefix>-source-to-action` shows the following:
  - Invocations and errors for ring-ingest, sequence-evaluator and operational-gate.
  - Visible messages per queue, plus the DLQ counts.
  - SEQSEAL outcome metrics.
  - A Logs Insights trace over `correlation_id`, `execution_id` and `msg`.
- **Outcome metrics**: `WorkflowReleased`, `WorkflowHeld`, `WorkflowReviewRequired`,
  `WorkflowAwaitingEvidence` and `SystemError` live in namespace `SEQSEAL` with dimension `Environment`.
  Functions should emit them with CloudWatch Embedded Metric Format (structured stdout logs). That needs no extra IAM.
  If you switch to `PutMetricData`, add `cloudwatch:PutMetricData` conditioned on `cloudwatch:namespace = SEQSEAL`.

## Design notes

- **No module cycles.** Queue policies live in `modules/event-bus`, next to the rules whose ARNs they pin.
  Module dependencies flow in one direction: `queues → event-bus → iam → lambdas → api / monitoring`.
- **SQS encryption is SSE-SQS, not the CMK.** EventBridge can deliver to it without extra key-policy grants.
  Messages carry ids and verdict metadata, never secrets or media.
- **The CMK key policy delegates to account IAM.** It is the default-equivalent policy.
  Roles get key usage only through DynamoDB, S3 and Secrets Manager.
- **Reserved concurrency is not set**, by design.
- **SQS event source mappings** use batch size 1, `ReportBatchItemFailures` and no batching window.
  The visibility timeout is 6 × the consumer timeout: 180 s, or 360 s for media-interpretation-q.

## Checking the HCL

`terraform validate` needs provider downloads. For an offline syntax check, run this:

```bash
pnpm hcl:check        # node scripts/check-hcl.mjs — parses every *.tf (and HCL *.example) file
```

Before a real deployment, also run `terraform fmt -check -recursive` and
`terraform validate` in an environment directory.

## Teardown

- **dev:** `terraform destroy` in `environments/dev` (no protections there).
- **demo:** see §6: apply with `-var teardown=true`, then destroy with it.
