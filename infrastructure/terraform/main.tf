###############################################################################
# SEQSEAL — Physical Workflow Integrity
# Root module: serverless, event-driven pipeline
#
#   Ring webhook / Playground ──► API GW ──► ring-ingest / playground-adapter
#        ──► EventBridge bus ──► SQS (per stage) ──► Lambda (per stage) ──► ...
#        ──► sequence-evaluator (deterministic verdict, NO Bedrock by IAM)
#        ──► policy-evaluator ──► operational-gate ──► receipt-generator
#
# This module declares no provider block; see environments/<env>/main.tf.
###############################################################################

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  name_prefix = "${var.project}-${var.environment}"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  is_dev = var.environment == "dev"

  # Relative artifact dirs are resolved against THIS module's directory, so the
  # same default works from infrastructure/terraform and from environments/<env>.
  lambda_artifacts_dir = (
    startswith(var.lambda_artifacts_dir, "/") || can(regex("^[A-Za-z]:[\\\\/]", var.lambda_artifacts_dir))
    ? var.lambda_artifacts_dir
    : "${path.module}/${var.lambda_artifacts_dir}"
  )

  # ---------------------------------------------------------------------------
  # Function catalogue (single source of truth for names, sizing and triggers).
  # ---------------------------------------------------------------------------
  functions = {
    "ring-ingest" = {
      description         = "Verifies Ring webhook signatures, dedupes and publishes source events."
      memory              = 512
      timeout             = 30
      trigger             = "api"
      schedule_expression = null
    }
    "ring-playground-adapter" = {
      description         = "Captures events from the Ring Developer Playground / partner API on demand."
      memory              = 512
      timeout             = 30
      trigger             = "api"
      schedule_expression = null
    }
    "observation-normalizer" = {
      description         = "Normalizes raw Ring source events into observations."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "evidence-resolver" = {
      description         = "Resolves observations into evidence candidates bound to executions."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "media-interpreter" = {
      description         = "Optional media interpretation of evidence (Bedrock, feature-flagged). Never decides verdicts."
      memory              = 1024
      timeout             = 60
      trigger             = "sqs"
      schedule_expression = null
    }
    "sequence-evaluator" = {
      description         = "Deterministic PWPS protocol evaluation and finalization. No Bedrock access by IAM."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "policy-evaluator" = {
      description         = "Maps a verification verdict to an operational decision via the action policy."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "operational-gate" = {
      description         = "Applies the operational decision (RELEASE / HOLD / REVIEW / WAIT)."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "receipt-generator" = {
      description         = "Seals the workflow: generates the verifiable integrity receipt."
      memory              = 512
      timeout             = 30
      trigger             = "sqs"
      schedule_expression = null
    }
    "read-api" = {
      description         = "Read model API for the web console (GET /api/*)."
      memory              = 512
      timeout             = 30
      trigger             = "api"
      schedule_expression = null
    }
    "review-api" = {
      description         = "Human review submissions (POST /api/reviews)."
      memory              = 512
      timeout             = 30
      trigger             = "api"
      schedule_expression = null
    }
    "demo-orchestrator" = {
      description         = "Demo replay / reset controls (POST /api/demo/*). Never hard-codes verdicts."
      memory              = 512
      timeout             = 30
      trigger             = "api"
      schedule_expression = null
    }
    "execution-sweeper" = {
      description         = "Requests finalization of executions past their horizon."
      memory              = 512
      timeout             = 30
      trigger             = "schedule"
      schedule_expression = "rate(5 minutes)"
    }
  }

  function_names = { for k, _ in local.functions : k => "${local.name_prefix}-${k}" }

  # ---------------------------------------------------------------------------
  # Queue catalogue: queue => consuming function (+ optional delivery delay).
  # visibility timeout = 6 x consumer timeout (AWS guidance for SQS -> Lambda).
  # ---------------------------------------------------------------------------
  queue_catalogue = {
    "ring-observation-q"     = { consumer = "observation-normalizer", delay_seconds = 0 }
    "evidence-resolution-q"  = { consumer = "evidence-resolver", delay_seconds = 0 }
    "media-interpretation-q" = { consumer = "media-interpreter", delay_seconds = 0 }
    "protocol-evaluation-q"  = { consumer = "sequence-evaluator", delay_seconds = 0 }
    "finalization-q"         = { consumer = "sequence-evaluator", delay_seconds = var.finalization_grace_seconds }
    "operational-decision-q" = { consumer = "policy-evaluator", delay_seconds = 0 }
    "operational-gate-q"     = { consumer = "operational-gate", delay_seconds = 0 }
    "receipt-generation-q"   = { consumer = "receipt-generator", delay_seconds = 0 }
  }

  queues = {
    for q, c in local.queue_catalogue : q => {
      visibility_timeout_seconds = 6 * local.functions[c.consumer].timeout
      delay_seconds              = c.delay_seconds
    }
  }

  function_queues = {
    for fn, _ in local.functions : fn => [for q, c in local.queue_catalogue : q if c.consumer == fn]
  }

  # ---------------------------------------------------------------------------
  # EventBridge routing: target queue => detail-types (Source = "seqseal").
  # ---------------------------------------------------------------------------
  event_routes = {
    "ring-observation-q"     = ["seqseal.ring.source_event_received"]
    "evidence-resolution-q"  = ["seqseal.observation.normalized"]
    "media-interpretation-q" = ["seqseal.evidence.interpretation_requested"]
    "protocol-evaluation-q" = [
      "seqseal.evidence.accepted",
      "seqseal.evidence.unresolved",
      "seqseal.evidence.reviewed",
      "seqseal.execution.correlation_ambiguity",
      "seqseal.ring.source_health_changed",
    ]
    "finalization-q"         = ["seqseal.execution.finalization_requested"]
    "operational-decision-q" = ["seqseal.verification.completed"]
    "operational-gate-q"     = ["seqseal.operation.decision_created"]
    "receipt-generation-q"   = ["seqseal.operation.action_applied"]
  }

  # ---------------------------------------------------------------------------
  # HTTP API routes => function.
  # ---------------------------------------------------------------------------
  api_routes = {
    "POST /integrations/ring/webhook"            = { function = "ring-ingest" }
    "POST /integrations/ring/playground/capture" = { function = "ring-playground-adapter" }
    "GET /api/{proxy+}"                          = { function = "read-api" }
    "POST /api/reviews"                          = { function = "review-api" }
    "POST /api/demo/{proxy+}"                    = { function = "demo-orchestrator" }
  }
}

# The caller's provider region must match var.aws_region (surfaced as a warning).
check "provider_region_matches" {
  assert {
    condition     = data.aws_region.current.name == var.aws_region
    error_message = "Provider region (${data.aws_region.current.name}) differs from var.aws_region (${var.aws_region})."
  }
}

###############################################################################
# Data plane
###############################################################################

module "secrets" {
  source = "./modules/secrets"

  name_prefix              = local.name_prefix
  recovery_window_in_days  = local.is_dev ? 0 : 7
  kms_deletion_window_days = local.is_dev ? 7 : 30
  tags                     = local.tags
}

module "dynamodb" {
  source = "./modules/dynamodb"

  name_prefix         = local.name_prefix
  kms_key_arn         = module.secrets.kms_key_arn
  deletion_protection = var.dynamodb_deletion_protection
  tags                = local.tags
}

module "s3" {
  source = "./modules/s3"

  name_prefix   = local.name_prefix
  account_id    = data.aws_caller_identity.current.account_id
  kms_key_arn   = module.secrets.kms_key_arn
  force_destroy = local.is_dev
  tags          = local.tags
}

###############################################################################
# Messaging
###############################################################################

module "queues" {
  source = "./modules/queues"

  name_prefix = local.name_prefix
  queues      = local.queues
  tags        = local.tags
}

module "event_bus" {
  source = "./modules/event-bus"

  name_prefix            = local.name_prefix
  event_source           = "seqseal"
  routes                 = local.event_routes
  queue_arns             = module.queues.queue_arns
  queue_urls             = module.queues.queue_urls
  archive_retention_days = 7
  tags                   = local.tags
}

###############################################################################
# Compute
###############################################################################

module "iam" {
  source = "./modules/iam"

  function_names       = local.function_names
  table_arns           = module.dynamodb.table_arns
  artifact_bucket_arn  = module.s3.bucket_arn
  kms_key_arn          = module.secrets.kms_key_arn
  event_bus_arn        = module.event_bus.event_bus_arn
  secret_arns          = module.secrets.secret_arns
  allow_bedrock_invoke = var.enable_bedrock_evidence
  tags                 = local.tags

  consumer_queue_arns = {
    for fn, qs in local.function_queues : fn => [for q in qs : module.queues.queue_arns[q]]
  }
}

module "lambdas" {
  source = "./modules/lambdas"

  functions = {
    for fn, f in local.functions : fn => merge(f, { queues = local.function_queues[fn] })
  }
  function_names     = local.function_names
  role_arns          = module.iam.role_arns
  queue_arns         = module.queues.queue_arns
  artifacts_dir      = local.lambda_artifacts_dir
  log_retention_days = var.log_retention_days
  tags               = local.tags

  environment_variables = {
    SEQSEAL_ENVIRONMENT        = var.environment
    SEQSEAL_TABLE_EXECUTIONS   = module.dynamodb.table_names["executions"]
    SEQSEAL_TABLE_EVIDENCE     = module.dynamodb.table_names["evidence"]
    SEQSEAL_TABLE_CONFIG       = module.dynamodb.table_names["config"]
    SEQSEAL_TABLE_IDEMPOTENCY  = module.dynamodb.table_names["idempotency"]
    SEQSEAL_EVENT_BUS          = module.event_bus.event_bus_name
    SEQSEAL_ARTIFACT_BUCKET    = module.s3.bucket_name
    SEQSEAL_CONFIG_DIR         = "/var/task/seqseal-config"
    FINALIZATION_GRACE_SECONDS = tostring(var.finalization_grace_seconds)
    EXECUTION_HORIZON_MINUTES  = tostring(var.execution_horizon_minutes)
    ENABLE_BEDROCK_EVIDENCE    = var.enable_bedrock_evidence ? "true" : "false"
    BEDROCK_DISABLED           = var.enable_bedrock_evidence ? "false" : "true"
    BEDROCK_EVIDENCE_MODEL_ID  = var.bedrock_model_id
    DEMO_MODE                  = var.demo_mode ? "true" : "false"
    NODE_OPTIONS               = "--enable-source-maps"
    RING_API_BASE_URL          = var.ring_api_base_url
    RING_SIGNING_SECRET_ARN    = module.secrets.ring_webhook_signing_secret_arn
    RING_API_TOKEN_SECRET_ARN  = module.secrets.ring_api_token_secret_arn
    DEMO_TOKEN_SECRET_ARN      = module.secrets.demo_token_secret_arn
  }
}

###############################################################################
# Edge
###############################################################################

module "api" {
  source = "./modules/api"

  name_prefix        = local.name_prefix
  routes             = local.api_routes
  function_names     = module.lambdas.function_names
  invoke_arns        = module.lambdas.invoke_arns
  allowed_origins    = var.web_allowed_origins
  log_retention_days = var.log_retention_days
  tags               = local.tags
}

###############################################################################
# Observability
###############################################################################

module "monitoring" {
  source = "./modules/monitoring"

  name_prefix          = local.name_prefix
  environment          = var.environment
  function_names       = module.lambdas.function_names
  queue_names          = module.queues.queue_names
  dlq_names            = module.queues.dlq_names
  eventbridge_dlq_name = module.event_bus.eventbridge_dlq_name
  alarm_email          = var.alarm_email
  tags                 = local.tags
}
