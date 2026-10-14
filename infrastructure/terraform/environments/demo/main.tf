###############################################################################
# SEQSEAL — demo environment (judge-facing, stable)
#
#   cd infrastructure/terraform/environments/demo
#   cp terraform.tfvars.example terraform.tfvars   # set web_allowed_origins, alarm_email
#   cp backend.tf.example backend.tf               # recommended: remote state
#   terraform init && terraform plan -out tfplan && terraform apply tfplan
###############################################################################

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

variable "aws_region" {
  description = "AWS region to deploy to."
  type        = string
  default     = "us-east-1"
}

variable "lambda_artifacts_dir" {
  description = "Bundle directory (<dir>/<name>/dist/<name>.zip). Relative paths resolve against infrastructure/terraform, so the default points at <repo>/services."
  type        = string
  default     = "../../services"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention in days."
  type        = number
  default     = 14
}

variable "bedrock_model_id" {
  description = "Bedrock model / inference-profile id for the media interpreter (empty = none)."
  type        = string
  default     = ""
}

variable "enable_bedrock_evidence" {
  description = "Enable Bedrock-assisted media interpretation (never verdicts)."
  type        = bool
  default     = false
}

variable "finalization_grace_seconds" {
  description = "Finalization grace window (finalization-q delay), 0-900 seconds."
  type        = number
  default     = 5
}

variable "execution_horizon_minutes" {
  description = "Execution horizon before the sweeper requests finalization."
  type        = number
  default     = 30
}

variable "web_allowed_origins" {
  description = "CORS allowed origins for the web console (add the deployed console origin)."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "alarm_email" {
  description = "Optional e-mail for alarm notifications (empty = none)."
  type        = string
  default     = ""
}

variable "demo_mode" {
  description = "DEMO_MODE flag."
  type        = bool
  default     = true
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "seqseal"
      Environment = "demo"
      ManagedBy   = "terraform"
    }
  }
}

module "seqseal" {
  source = "../.."

  project     = "seqseal"
  environment = "demo"
  aws_region  = var.aws_region

  lambda_artifacts_dir       = var.lambda_artifacts_dir
  log_retention_days         = var.log_retention_days
  bedrock_model_id           = var.bedrock_model_id
  enable_bedrock_evidence    = var.enable_bedrock_evidence
  finalization_grace_seconds = var.finalization_grace_seconds
  execution_horizon_minutes  = var.execution_horizon_minutes
  web_allowed_origins        = var.web_allowed_origins
  alarm_email                = var.alarm_email
  demo_mode                  = var.demo_mode

  # demo: protect tables from accidental destroy; secrets keep a 7-day recovery window.
  dynamodb_deletion_protection = true
}

output "api_endpoint" {
  description = "HTTP API base URL."
  value       = module.seqseal.api_endpoint
}

output "webhook_url" {
  description = "Ring webhook URL."
  value       = module.seqseal.webhook_url
}

output "event_bus_name" {
  description = "Custom EventBridge bus name."
  value       = module.seqseal.event_bus_name
}

output "tables" {
  description = "DynamoDB table names."
  value       = module.seqseal.tables
}

output "artifact_bucket" {
  description = "Artifact bucket name."
  value       = module.seqseal.artifact_bucket
}

output "secret_arns" {
  description = "Secrets Manager ARNs whose values must be set out-of-band."
  value = {
    ring_webhook_signing_secret = module.seqseal.ring_webhook_signing_secret_arn
    ring_api_token              = module.seqseal.ring_api_token_secret_arn
    demo_token                  = module.seqseal.demo_token_secret_arn
  }
}

output "dashboard_name" {
  description = "CloudWatch dashboard name."
  value       = module.seqseal.dashboard_name
}
