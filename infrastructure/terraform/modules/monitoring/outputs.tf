output "dashboard_name" {
  description = "Name of the source-to-action CloudWatch dashboard."
  value       = aws_cloudwatch_dashboard.source_to_action.dashboard_name
}

output "alarm_topic_arn" {
  description = "ARN of the alarm SNS topic (null when alarm_email is empty)."
  value       = try(aws_sns_topic.alarms[0].arn, null)
}

output "dlq_alarm_names" {
  description = "DLQ alarm names keyed by queue logical name (plus \"eventbridge\")."
  value       = { for k, a in aws_cloudwatch_metric_alarm.dlq_not_empty : k => a.alarm_name }
}

output "lambda_error_alarm_names" {
  description = "Lambda error alarm names keyed by function short name."
  value       = { for k, a in aws_cloudwatch_metric_alarm.lambda_errors : k => a.alarm_name }
}
