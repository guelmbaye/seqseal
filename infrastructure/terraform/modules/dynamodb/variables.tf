variable "name_prefix" {
  description = "Resource name prefix, e.g. seqseal-dev."
  type        = string
}

variable "kms_key_arn" {
  description = "ARN of the customer-managed KMS key used for table server-side encryption."
  type        = string
}

variable "deletion_protection" {
  description = "Enable DynamoDB deletion protection on every table."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags applied to every table."
  type        = map(string)
  default     = {}
}
