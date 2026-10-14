variable "functions" {
  description = <<-EOT
    Function catalogue keyed by short name (e.g. ring-ingest).
      description         : human description
      memory              : memory size (MB)
      timeout             : timeout (seconds)
      trigger             : "api" | "sqs" | "schedule" (informational tag)
      queues              : logical queue names consumed via SQS event source mappings
      schedule_expression : EventBridge schedule (default bus) or null
  EOT
  type = map(object({
    description         = string
    memory              = number
    timeout             = number
    trigger             = string
    queues              = optional(list(string), [])
    schedule_expression = optional(string)
  }))

  validation {
    condition     = alltrue([for f in values(var.functions) : contains(["api", "sqs", "schedule"], f.trigger)])
    error_message = "trigger must be one of: api, sqs, schedule."
  }
}

variable "function_names" {
  description = "Physical function names keyed by short name."
  type        = map(string)
}

variable "role_arns" {
  description = "Execution role ARNs keyed by short name (from modules/iam)."
  type        = map(string)
}

variable "queue_arns" {
  description = "Work-queue ARNs keyed by logical queue name (event source mappings)."
  type        = map(string)
}

variable "artifacts_dir" {
  description = "Directory containing <name>/dist/<name>.zip bundles (already resolved by the root module)."
  type        = string
}

variable "environment_variables" {
  description = "Environment variables shared by every function. SEQSEAL_FUNCTION is added per function."
  type        = map(string)
}

variable "log_retention_days" {
  description = "Retention (days) of the /aws/lambda/<function> log groups."
  type        = number
}

variable "tags" {
  description = "Tags applied to functions, log groups, mappings and schedule rules."
  type        = map(string)
  default     = {}
}
