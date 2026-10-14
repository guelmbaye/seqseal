output "event_bus_name" {
  description = "Name of the custom SEQSEAL event bus."
  value       = aws_cloudwatch_event_bus.this.name
}

output "event_bus_arn" {
  description = "ARN of the custom SEQSEAL event bus."
  value       = aws_cloudwatch_event_bus.this.arn
}

output "archive_arn" {
  description = "ARN of the bus archive (null when disabled)."
  value       = try(aws_cloudwatch_event_archive.this[0].arn, null)
}

output "rule_arns" {
  description = "Routing rule ARNs keyed by target queue logical name."
  value       = { for k, r in aws_cloudwatch_event_rule.route : k => r.arn }
}

output "eventbridge_dlq_name" {
  description = "Name of the shared EventBridge target DLQ."
  value       = aws_sqs_queue.eventbridge_dlq.name
}

output "eventbridge_dlq_arn" {
  description = "ARN of the shared EventBridge target DLQ."
  value       = aws_sqs_queue.eventbridge_dlq.arn
}
