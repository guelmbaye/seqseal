output "queue_arns" {
  description = "Work-queue ARNs keyed by logical queue name."
  value       = { for k, q in aws_sqs_queue.this : k => q.arn }
}

output "queue_urls" {
  description = "Work-queue URLs keyed by logical queue name."
  value       = { for k, q in aws_sqs_queue.this : k => q.id }
}

output "queue_names" {
  description = "Work-queue physical names keyed by logical queue name."
  value       = { for k, q in aws_sqs_queue.this : k => q.name }
}

output "dlq_arns" {
  description = "DLQ ARNs keyed by logical (work) queue name."
  value       = { for k, q in aws_sqs_queue.dlq : k => q.arn }
}

output "dlq_names" {
  description = "DLQ physical names keyed by logical (work) queue name."
  value       = { for k, q in aws_sqs_queue.dlq : k => q.name }
}
