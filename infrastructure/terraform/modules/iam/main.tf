###############################################################################
# IAM — one execution role per Lambda, least privilege.
#
# ┌──────────────────────────────────────────────────────────────────────────┐
# │ The Sequence Evaluator cannot invoke Bedrock: verdict authority is       │
# │ deterministic by IAM, not by prompt.                                     │
# │                                                                          │
# │ Only the media-interpreter may call Bedrock, and only to *interpret*     │
# │ evidence (and only when enable_bedrock_evidence = true). Every role on   │
# │ the verdict / decision / action / receipt path (sequence-evaluator,      │
# │ policy-evaluator, operational-gate, receipt-generator) carries an        │
# │ EXPLICIT Deny on bedrock:* — an explicit Deny cannot be overridden by    │
# │ any Allow added later (inline, managed, or via a permissions boundary    │
# │ mistake), so a model can never become the source of a verdict or an      │
# │ operational action without a visible change to this file.                │
# └──────────────────────────────────────────────────────────────────────────┘
#
# The authority table below is the single source of truth (mirrored in
# README.md). Every role also gets:
#   - logs:CreateLogStream / logs:PutLogEvents on its OWN log group only
#   - xray:PutTraceSegments / xray:PutTelemetryRecords (no resource scoping exists)
#   - kms:Decrypt / kms:GenerateDataKey / kms:DescribeKey on the project CMK,
#     only via DynamoDB / S3 / Secrets Manager (kms:ViaService). All roles
#     touch CMK-encrypted DynamoDB; secrets and artifacts use the same CMK.
#   - sqs:ReceiveMessage / DeleteMessage / GetQueueAttributes /
#     ChangeMessageVisibility on the queue(s) it consumes, and nothing else.
###############################################################################

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_partition" "current" {}

locals {
  partition  = data.aws_partition.current.partition
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id

  # DynamoDB action sets
  ddb_read       = ["dynamodb:GetItem", "dynamodb:Query"]
  ddb_get_put    = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
  ddb_rw         = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
  ddb_rw_delete  = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:DeleteItem"]
  all_table_keys = ["executions", "evidence", "config", "idempotency"]

  # ---------------------------------------------------------------------------
  # Authority table. Keys are function short names.
  #   dynamodb       : list of { tables, actions }
  #   put_events     : events:PutEvents on the SEQSEAL bus
  #   secrets        : secret logical names (see modules/secrets)
  #   s3             : list of { actions, prefix } on the artifact bucket
  #   bedrock_invoke : may invoke Bedrock models (still gated by var.allow_bedrock_invoke)
  #   deny_bedrock   : explicit Deny bedrock:* on "*"
  # ---------------------------------------------------------------------------
  authority = {
    "ring-ingest" = {
      dynamodb       = [{ tables = ["idempotency", "evidence", "executions"], actions = local.ddb_rw }]
      put_events     = true
      secrets        = ["ring_webhook_signing_secret"]
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "ring-playground-adapter" = {
      dynamodb       = [{ tables = ["idempotency", "evidence", "executions"], actions = local.ddb_rw }]
      put_events     = true
      secrets        = ["ring_api_token", "demo_token"]
      s3             = [{ actions = ["s3:PutObject"], prefix = "media/*" }] # snapshot captures
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "observation-normalizer" = {
      dynamodb       = [{ tables = ["idempotency", "evidence", "executions"], actions = local.ddb_rw }]
      put_events     = true
      secrets        = []
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "evidence-resolver" = {
      dynamodb       = [{ tables = ["evidence", "executions", "config"], actions = local.ddb_rw_delete }]
      put_events     = true
      secrets        = []
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "media-interpreter" = {
      dynamodb       = [{ tables = ["evidence", "executions", "config"], actions = local.ddb_rw_delete }]
      put_events     = true
      secrets        = ["ring_api_token"] # fresh Ring snapshot when a webhook observation needs media
      s3             = [{ actions = ["s3:GetObject", "s3:PutObject"], prefix = "media/*" }]
      bedrock_invoke = true
      deny_bedrock   = false
    }
    "sequence-evaluator" = {
      dynamodb = [
        { tables = ["executions", "config"], actions = local.ddb_rw_delete },
        { tables = ["evidence"], actions = local.ddb_read },
      ]
      put_events     = true
      secrets        = []
      s3             = [{ actions = ["s3:PutObject"], prefix = "evaluations/*" }]
      bedrock_invoke = false
      deny_bedrock   = true
    }
    "policy-evaluator" = {
      dynamodb       = [{ tables = ["executions"], actions = local.ddb_get_put }]
      put_events     = true
      secrets        = []
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = true
    }
    "operational-gate" = {
      dynamodb       = [{ tables = ["executions"], actions = local.ddb_rw }]
      put_events     = true
      secrets        = []
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = true
    }
    "receipt-generator" = {
      dynamodb = [
        { tables = ["executions"], actions = local.ddb_rw },
        { tables = ["evidence"], actions = local.ddb_read },
        { tables = ["config"], actions = local.ddb_read }, # source config the receipt cites
      ]
      put_events     = true
      secrets        = []
      s3             = [{ actions = ["s3:PutObject"], prefix = "receipts/*" }]
      bedrock_invoke = false
      deny_bedrock   = true
    }
    "read-api" = {
      dynamodb       = [{ tables = local.all_table_keys, actions = local.ddb_read }]
      put_events     = false
      secrets        = []
      s3             = [{ actions = ["s3:GetObject"], prefix = "receipts/*" }]
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "review-api" = {
      dynamodb       = [{ tables = ["executions", "evidence", "config"], actions = local.ddb_rw }]
      put_events     = true
      secrets        = ["demo_token"]
      s3             = []
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "demo-orchestrator" = {
      dynamodb       = [{ tables = local.all_table_keys, actions = local.ddb_rw_delete }]
      put_events     = true
      secrets        = ["demo_token"]
      s3             = [{ actions = ["s3:PutObject"], prefix = "evaluations/*" }] # finalize evaluates inline
      bedrock_invoke = false
      deny_bedrock   = false
    }
    "execution-sweeper" = {
      dynamodb = [
        { tables = ["executions", "config"], actions = local.ddb_rw_delete },
        { tables = ["evidence"], actions = local.ddb_read },
      ]
      put_events     = true
      secrets        = []
      s3             = [{ actions = ["s3:PutObject"], prefix = "evaluations/*" }] # finalize evaluates inline
      bedrock_invoke = false
      deny_bedrock   = false
    }
  }

  # ---------------------------------------------------------------------------
  # Policy statements per function, assembled from the authority table.
  # ---------------------------------------------------------------------------
  policy_statements = {
    for fn, a in local.authority : fn => concat(
      [
        {
          Sid    = "OwnLogGroup"
          Effect = "Allow"
          Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = [
            "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/${var.function_names[fn]}:*",
          ]
        },
        {
          Sid      = "XRayWrite"
          Effect   = "Allow"
          Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
          Resource = "*"
        },
        {
          # Usable only through the services that hold CMK-encrypted data.
          Sid      = "ProjectKmsKeyViaDataServices"
          Effect   = "Allow"
          Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
          Resource = var.kms_key_arn
          Condition = {
            StringEquals = {
              "kms:ViaService" = [
                "dynamodb.${local.region}.amazonaws.com",
                "s3.${local.region}.amazonaws.com",
                "secretsmanager.${local.region}.amazonaws.com",
              ]
            }
          }
        },
      ],
      [
        for i, d in a.dynamodb : {
          Sid    = "DynamoDb${i}"
          Effect = "Allow"
          Action = d.actions
          Resource = flatten([
            for t in d.tables : [var.table_arns[t], "${var.table_arns[t]}/index/*"]
          ])
        }
      ],
      a.put_events ? [
        {
          Sid      = "PutEventsOnSeqsealBus"
          Effect   = "Allow"
          Action   = "events:PutEvents"
          Resource = var.event_bus_arn
        },
      ] : [],
      length(a.secrets) > 0 ? [
        {
          Sid      = "ReadOwnSecrets"
          Effect   = "Allow"
          Action   = "secretsmanager:GetSecretValue"
          Resource = [for s in a.secrets : var.secret_arns[s]]
        },
      ] : [],
      [
        for i, s in a.s3 : {
          Sid      = "ArtifactBucket${i}"
          Effect   = "Allow"
          Action   = s.actions
          Resource = "${var.artifact_bucket_arn}/${s.prefix}"
        }
      ],
      length(try(var.consumer_queue_arns[fn], [])) > 0 ? [
        {
          Sid    = "ConsumeOwnQueues"
          Effect = "Allow"
          Action = [
            "sqs:ReceiveMessage",
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes",
            "sqs:ChangeMessageVisibility",
          ]
          Resource = try(var.consumer_queue_arns[fn], [])
        },
      ] : [],
      # bedrock:Converse / ConverseStream are authorized by these same two actions.
      # NOTE: a cross-region inference profile also needs foundation-model access
      # in each destination region; extend the resource list if you use one.
      a.bedrock_invoke && var.allow_bedrock_invoke ? [
        {
          Sid    = "InterpretEvidenceWithBedrock"
          Effect = "Allow"
          Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
          Resource = [
            "arn:${local.partition}:bedrock:${local.region}::foundation-model/*",
            "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/*",
          ]
        },
      ] : [],
      a.deny_bedrock ? [
        {
          Sid      = "DenyBedrockVerdictAuthority"
          Effect   = "Deny"
          Action   = "bedrock:*"
          Resource = "*"
        },
      ] : [],
    )
  }
}

resource "aws_iam_role" "this" {
  for_each = local.authority

  name        = "${var.function_names[each.key]}-role"
  description = "Execution role for ${var.function_names[each.key]} (least privilege, see infrastructure/terraform/README.md)."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "LambdaAssumeRole"
        Effect    = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })

  tags = merge(var.tags, {
    Name     = "${var.function_names[each.key]}-role"
    Function = each.key
  })
}

resource "aws_iam_role_policy" "this" {
  for_each = local.authority

  name = "${var.function_names[each.key]}-least-privilege"
  role = aws_iam_role.this[each.key].id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.policy_statements[each.key]
  })
}
