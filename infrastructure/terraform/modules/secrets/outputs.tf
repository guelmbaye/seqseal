output "kms_key_arn" {
  description = "ARN of the project customer-managed KMS key."
  value       = aws_kms_key.this.arn
}

output "kms_key_id" {
  description = "Key id of the project customer-managed KMS key."
  value       = aws_kms_key.this.key_id
}

output "kms_alias_name" {
  description = "Alias of the project KMS key (alias/<name_prefix>)."
  value       = aws_kms_alias.this.name
}

output "ring_webhook_signing_secret_arn" {
  description = "ARN of the Ring webhook HMAC signing secret."
  value       = aws_secretsmanager_secret.this["ring_webhook_signing_secret"].arn
}

output "ring_api_token_secret_arn" {
  description = "ARN of the Ring API (Developer Playground / partner) bearer token secret."
  value       = aws_secretsmanager_secret.this["ring_api_token"].arn
}

output "demo_token_secret_arn" {
  description = "ARN of the shared demo/review token secret."
  value       = aws_secretsmanager_secret.this["demo_token"].arn
}

output "secret_arns" {
  description = "All secret ARNs keyed by logical name (ring_webhook_signing_secret, ring_api_token, demo_token)."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}
