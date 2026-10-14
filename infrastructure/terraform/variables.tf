variable "project" {
  description = "Project slug used as the first segment of every resource name."
  type        = string
  default     = "seqseal"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.project))
    error_message = "project must be 2-20 characters of lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Deployment environment. Only dev and demo are supported."
  type        = string

  validation {
    condition     = contains(["dev", "demo"], var.environment)
    error_message = "environment must be one of: dev, demo."
  }
}

variable "aws_region" {
  description = "AWS region the stack is deployed to. Must match the region of the provider configuration passed by the caller (asserted by a check block in main.tf)."
  type        = string
  default     = "us-east-1"
}

variable "lambda_artifacts_dir" {
  description = <<-EOT
    Directory that contains the Lambda bundles, laid out as <dir>/<function>/dist/<function>.zip
    (this is what `pnpm build:lambdas` produces under services/).
    A RELATIVE path is resolved against this root module's directory (infrastructure/terraform),
    so the default "../../services" points at <repo>/services regardless of whether Terraform is run
    from infrastructure/terraform or from infrastructure/terraform/environments/<env>.
    An ABSOLUTE path is used as-is.
  EOT
  type        = string
  default     = "../../services"
  nullable    = false
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for Lambda and API access log groups."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a value supported by CloudWatch Logs (1, 3, 5, 7, 14, 30, 60, 90, ...)."
  }
}

variable "bedrock_model_id" {
  description = "Bedrock model or inference-profile id used by the media interpreter (BEDROCK_EVIDENCE_MODEL_ID). Empty disables model calls."
  type        = string
  default     = ""
}

variable "enable_bedrock_evidence" {
  description = "Feature flag (ENABLE_BEDROCK_EVIDENCE). When true the media interpreter may ask Bedrock to interpret media evidence. Verdicts never depend on it."
  type        = bool
  default     = false
}

variable "finalization_grace_seconds" {
  description = "Grace window before an execution is finalized. Applied as the SQS delay of finalization-q (max 900) and exported as FINALIZATION_GRACE_SECONDS."
  type        = number
  default     = 5

  validation {
    condition     = var.finalization_grace_seconds >= 0 && var.finalization_grace_seconds <= 900 && floor(var.finalization_grace_seconds) == var.finalization_grace_seconds
    error_message = "finalization_grace_seconds must be an integer between 0 and 900 (SQS DelaySeconds limit)."
  }
}

variable "execution_horizon_minutes" {
  description = "How long an execution may stay open before the sweeper requests finalization (EXECUTION_HORIZON_MINUTES)."
  type        = number
  default     = 30

  validation {
    condition     = var.execution_horizon_minutes > 0
    error_message = "execution_horizon_minutes must be greater than 0."
  }
}

variable "web_allowed_origins" {
  description = "Origins allowed by the HTTP API CORS configuration (the web console)."
  type        = list(string)
  default     = ["http://localhost:3000"]

  validation {
    condition     = length(var.web_allowed_origins) > 0
    error_message = "web_allowed_origins must contain at least one origin."
  }
}

variable "alarm_email" {
  description = "Optional e-mail address subscribed to the alarm SNS topic. Empty string = no SNS topic is created."
  type        = string
  default     = ""

  validation {
    condition     = var.alarm_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email))
    error_message = "alarm_email must be empty or a valid e-mail address."
  }
}

variable "demo_mode" {
  description = "DEMO_MODE flag: stable protocol/policy/bindings and replay controls. Never hard-codes verdicts."
  type        = bool
  default     = true
}

variable "dynamodb_deletion_protection" {
  description = "Enable DynamoDB deletion protection on all tables (off for dev, on for demo)."
  type        = bool
  default     = false
}

variable "ring_api_base_url" {
  description = "Ring Partner API base URL (https://developer.amazon.com/docs/ring/api-reference.html). Override if the Developer Playground uses a different host."
  type        = string
  default     = "https://api.amazonvision.com"
}
