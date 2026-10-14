output "role_arns" {
  description = "Execution role ARNs keyed by function short name."
  value       = { for k, r in aws_iam_role.this : k => r.arn }

  # Consumers (Lambda functions, SQS event source mappings) must not be created
  # before the inline policies exist, otherwise ESM creation fails its SQS
  # permission check and first invocations can be denied.
  depends_on = [aws_iam_role_policy.this]
}

output "role_names" {
  description = "Execution role names keyed by function short name."
  value       = { for k, r in aws_iam_role.this : k => r.name }
}

output "function_keys" {
  description = "Function short names covered by the authority table."
  value       = keys(local.authority)
}
