variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "environment" {
  description = "Environment name, used as the Environment dimension of custom SEQSEAL metrics."
  type        = string
}

variable "function_names" {
  description = "Lambda function names keyed by short name. Every function gets an Errors alarm."
  type        = map(string)
}

variable "dashboard_function_keys" {
  description = "Function short names shown on the dashboard (invocation/error widgets and Logs Insights sources)."
  type        = list(string)
  default     = ["ring-ingest", "sequence-evaluator", "operational-gate"]
}

variable "queue_names" {
  description = "Work-queue physical names keyed by logical name (dashboard)."
  type        = map(string)
}

variable "dlq_names" {
  description = "DLQ physical names keyed by logical (work) queue name. Each gets a not-empty alarm."
  type        = map(string)
}

variable "eventbridge_dlq_name" {
  description = "Physical name of the shared EventBridge target DLQ (gets a not-empty alarm)."
  type        = string
}

variable "metric_namespace" {
  description = "CloudWatch namespace of the custom outcome metrics emitted by the pipeline."
  type        = string
  default     = "SEQSEAL"
}

variable "alarm_email" {
  description = "Optional e-mail subscribed to an SNS alarm topic. Empty = no topic, alarms have no actions."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags applied to alarms and the SNS topic."
  type        = map(string)
  default     = {}
}
