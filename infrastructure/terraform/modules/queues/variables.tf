variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "queues" {
  description = <<-EOT
    Work queues keyed by logical name (e.g. ring-observation-q). Each gets a <name>-dlq.
    visibility_timeout_seconds should be 6x the consuming Lambda timeout.
    delay_seconds is the per-queue delivery delay (0-900), used for the finalization grace window.
  EOT
  type = map(object({
    visibility_timeout_seconds = number
    delay_seconds              = optional(number, 0)
  }))

  validation {
    condition     = alltrue([for q in values(var.queues) : q.delay_seconds >= 0 && q.delay_seconds <= 900])
    error_message = "delay_seconds must be between 0 and 900 for every queue."
  }

  validation {
    condition     = alltrue([for q in values(var.queues) : q.visibility_timeout_seconds >= 0 && q.visibility_timeout_seconds <= 43200])
    error_message = "visibility_timeout_seconds must be between 0 and 43200 for every queue."
  }
}

variable "max_receive_count" {
  description = "Receives before a message is moved to the queue's DLQ."
  type        = number
  default     = 5
}

variable "message_retention_seconds" {
  description = "Retention of work-queue messages (default 4 days)."
  type        = number
  default     = 345600
}

variable "dlq_message_retention_seconds" {
  description = "Retention of DLQ messages (default 14 days, the SQS maximum)."
  type        = number
  default     = 1209600
}

variable "tags" {
  description = "Tags applied to every queue."
  type        = map(string)
  default     = {}
}
