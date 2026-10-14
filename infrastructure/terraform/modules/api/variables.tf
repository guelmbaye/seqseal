variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "routes" {
  description = "HTTP API routes keyed by route key (e.g. \"POST /api/reviews\"), each pointing at a function short name."
  type = map(object({
    function = string
  }))
}

variable "function_names" {
  description = "Physical Lambda function names keyed by short name (for lambda permissions)."
  type        = map(string)
}

variable "invoke_arns" {
  description = "Lambda invoke ARNs keyed by short name (for AWS_PROXY integrations)."
  type        = map(string)
}

variable "allowed_origins" {
  description = "CORS allowed origins."
  type        = list(string)
}

variable "throttling_burst_limit" {
  description = "Default route throttling burst limit."
  type        = number
  default     = 50
}

variable "throttling_rate_limit" {
  description = "Default route throttling steady-state rate (requests/second)."
  type        = number
  default     = 25
}

variable "log_retention_days" {
  description = "Retention (days) of the API access log group."
  type        = number
}

variable "tags" {
  description = "Tags applied to API resources."
  type        = map(string)
  default     = {}
}
