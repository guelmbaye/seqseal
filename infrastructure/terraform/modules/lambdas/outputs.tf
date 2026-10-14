output "function_names" {
  description = "Function names keyed by short name."
  value       = { for k, f in aws_lambda_function.this : k => f.function_name }
}

output "function_arns" {
  description = "Function ARNs keyed by short name."
  value       = { for k, f in aws_lambda_function.this : k => f.arn }
}

output "invoke_arns" {
  description = "Function invoke ARNs (for API Gateway integrations) keyed by short name."
  value       = { for k, f in aws_lambda_function.this : k => f.invoke_arn }
}

output "log_group_names" {
  description = "Log group names keyed by short name."
  value       = { for k, g in aws_cloudwatch_log_group.this : k => g.name }
}

output "event_source_mapping_uuids" {
  description = "SQS event source mapping UUIDs keyed by <function>--<queue>."
  value       = { for k, m in aws_lambda_event_source_mapping.sqs : k => m.uuid }
}
