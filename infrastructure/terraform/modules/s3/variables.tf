variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "account_id" {
  description = "AWS account id, appended to the bucket name for global uniqueness."
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the customer-managed KMS key used for default bucket encryption (SSE-KMS)."
  type        = string
}

variable "media_expiration_days" {
  description = "Days after which objects under media/ (raw captures) expire."
  type        = number
  default     = 7
}

variable "noncurrent_version_expiration_days" {
  description = "Days after which noncurrent object versions are permanently deleted."
  type        = number
  default     = 30
}

variable "force_destroy" {
  description = "Allow terraform destroy to delete a non-empty bucket (all versions). Keep false outside throw-away environments."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to the bucket."
  type        = map(string)
  default     = {}
}
