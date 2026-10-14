variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "event_source" {
  description = "Event Source value used by every SEQSEAL publisher; rules only match this source."
  type        = string
  default     = "seqseal"
}

variable "routes" {
  description = "Routing table: target queue logical name => list of detail-type values routed to it."
  type        = map(list(string))

  validation {
    condition     = alltrue([for dts in values(var.routes) : length(dts) > 0])
    error_message = "Every route must list at least one detail-type."
  }
}

variable "queue_arns" {
  description = "Work-queue ARNs keyed by logical queue name (must contain every key of routes)."
  type        = map(string)
}

variable "queue_urls" {
  description = "Work-queue URLs keyed by logical queue name (must contain every key of routes)."
  type        = map(string)
}

variable "archive_retention_days" {
  description = "Retention of the bus archive in days. 0 disables the archive."
  type        = number
  default     = 7
}

variable "target_max_event_age_seconds" {
  description = "Maximum age of an event EventBridge keeps retrying to deliver to a target (60-86400)."
  type        = number
  default     = 3600
}

variable "target_max_retry_attempts" {
  description = "Maximum delivery retry attempts per target (0-185)."
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags applied to bus, rules and the EventBridge DLQ."
  type        = map(string)
  default     = {}
}
