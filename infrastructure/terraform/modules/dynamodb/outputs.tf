output "table_names" {
  description = "Table names keyed by logical name (executions, evidence, config, idempotency)."
  value       = { for k, t in aws_dynamodb_table.this : k => t.name }
}

output "table_arns" {
  description = "Table ARNs keyed by logical name (executions, evidence, config, idempotency)."
  value       = { for k, t in aws_dynamodb_table.this : k => t.arn }
}
