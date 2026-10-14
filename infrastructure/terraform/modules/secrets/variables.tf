variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev. Used for the KMS alias and secret names."
  type        = string
}

variable "recovery_window_in_days" {
  description = "Secrets Manager recovery window. 0 = force delete without recovery (dev); otherwise 7-30."
  type        = number
  default     = 7

  validation {
    condition     = var.recovery_window_in_days == 0 || (var.recovery_window_in_days >= 7 && var.recovery_window_in_days <= 30)
    error_message = "recovery_window_in_days must be 0 or between 7 and 30."
  }
}

variable "kms_deletion_window_days" {
  description = "Waiting period (7-30 days) before the KMS key is deleted after destroy."
  type        = number
  default     = 30

  validation {
    condition     = var.kms_deletion_window_days >= 7 && var.kms_deletion_window_days <= 30
    error_message = "kms_deletion_window_days must be between 7 and 30."
  }
}

variable "tags" {
  description = "Tags applied to the KMS key and secrets."
  type        = map(string)
  default     = {}
}
