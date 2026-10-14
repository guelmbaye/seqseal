variable "function_names" {
  description = "Physical Lambda function names keyed by short name (e.g. ring-ingest => seqseal-dev-ring-ingest). Must contain every function of the authority table."
  type        = map(string)
}

variable "table_arns" {
  description = "DynamoDB table ARNs keyed by logical name (executions, evidence, config, idempotency)."
  type        = map(string)
}

variable "artifact_bucket_arn" {
  description = "ARN of the artifact bucket."
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the project CMK (DynamoDB, S3 and Secrets Manager encryption)."
  type        = string
}

variable "event_bus_arn" {
  description = "ARN of the SEQSEAL custom event bus (events:PutEvents target)."
  type        = string
}

variable "secret_arns" {
  description = "Secret ARNs keyed by logical name (ring_webhook_signing_secret, ring_api_token, demo_token)."
  type        = map(string)
}

variable "consumer_queue_arns" {
  description = "SQS queue ARNs each function consumes, keyed by function short name. Functions without SQS triggers may be omitted or map to []."
  type        = map(list(string))
  default     = {}
}

variable "allow_bedrock_invoke" {
  description = "Grant bedrock:InvokeModel* to the roles flagged bedrock_invoke (media-interpreter only). Wired to enable_bedrock_evidence."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to every role."
  type        = map(string)
  default     = {}
}
