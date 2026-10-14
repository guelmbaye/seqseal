# Privacy

SEQSEAL works on events from cameras that watch people at work. It is designed to answer one question, "did the receiving process happen in the declared order?", with the least personal data that answer requires.

## 1. What SEQSEAL stores

| Data | Contains | Where | Retention |
|---|---|---|---|
| Raw Ring source record | the notification body (device id, event type and subtype, timestamps, Ring request id). HTTP headers are not stored. | DynamoDB `evidence` table / memory | life of the table |
| Normalized observation | device, logical zone, event type, physical time and precision | DynamoDB / memory | life of the table |
| Evidence, evaluations, decisions, receipts | workflow states, rule results, hashes, provenance ids | DynamoDB, receipts and evaluation snapshots as JSON in S3 | receipts are audit records; noncurrent S3 versions expire after 30 days |
| Idempotency keys | hashed delivery and event identifiers | DynamoDB `idempotency` table | TTL (`expires_at`) |
| Media (only if `ENABLE_BEDROCK_EVIDENCE=true`) | a single Ring snapshot for an observation that needs interpretation | S3 `media/` prefix, SSE-KMS | expires after 7 days (`media_expiration_days`) |

The local demo keeps everything in memory, and a restart or **Reset demo** erases it.

## 2. What SEQSEAL does not do

- **No identification.** There is no face recognition and no person re-identification, and no tracking of an individual across zones. Evidence is about *states* (STAGING happened), not *people*. Ring's `human` subtype is a motion class, used only as "activity in the staging zone".
- **No video by default.** The decision path uses event metadata. Media is fetched only when a mapping is explicitly `AI_ASSISTED`, Bedrock is enabled, and the metadata alone cannot support the state. The snapshot is then sent to Bedrock in the deployment's own AWS account.
- **No performance scoring.** A DEVIATED verdict means the sequence was wrong. It says nothing about who caused it, and SEQSEAL stores no worker identity that could attribute it.
- **No secrets on disk or in logs.** Webhook signing keys, the Ring API token and the demo token live in Secrets Manager (KMS-encrypted) on AWS and in environment variables locally. `scripts/ring-spike.ts` redacts the token from every file it writes. The JSON logger masks secret-looking fields and bearer tokens (`redactForLog`, covered by a test).

## 3. Access

- Mutating endpoints are protected by a demo/operator token in `x-seqseal-demo-token`, compared in constant time:
  - Playground capture;
  - review;
  - demo controls.
- The Ring webhook is protected by its HMAC signature.
- Each Lambda role can only read and write the tables, queues and prefixes its stage needs (`infrastructure/terraform/modules/iam`).
- The S3 bucket rejects non-TLS requests and is encrypted with a customer-managed KMS key with rotation enabled.

## 4. Deployment responsibilities

A site operator deploying SEQSEAL remains responsible for:

- telling workers that cameras are used for process verification, and for what;
- placing cameras so that they cover process zones, not break areas or other private spaces;
- choosing retention periods that match local law and policy;
- the lawful basis for processing (for example, legitimate interest in goods-receiving integrity), and any data protection impact assessment their jurisdiction requires.

SEQSEAL is not a legal compliance product; see [CLAIMS.md](CLAIMS.md).
