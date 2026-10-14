output "api_endpoint" {
  description = "Base URL of the HTTP API (set SEQSEAL_API_URL of the web console to this)."
  value       = module.api.api_endpoint
}

output "webhook_url" {
  description = "Ring webhook URL to register with the Ring Developer Platform."
  value       = "${module.api.api_endpoint}/integrations/ring/webhook"
}

output "playground_capture_url" {
  description = "Ring Developer Playground capture endpoint (requires x-seqseal-demo-token)."
  value       = "${module.api.api_endpoint}/integrations/ring/playground/capture"
}

output "event_bus_name" {
  description = "Name of the SEQSEAL custom EventBridge bus."
  value       = module.event_bus.event_bus_name
}

output "tables" {
  description = "DynamoDB table names keyed by logical name (executions, evidence, config, idempotency)."
  value       = module.dynamodb.table_names
}

output "artifact_bucket" {
  description = "Name of the S3 artifact bucket."
  value       = module.s3.bucket_name
}

output "ring_webhook_signing_secret_arn" {
  description = "Secrets Manager ARN of the Ring webhook signing secret (set its value out-of-band)."
  value       = module.secrets.ring_webhook_signing_secret_arn
}

output "ring_api_token_secret_arn" {
  description = "Secrets Manager ARN of the Ring API bearer token (set its value out-of-band)."
  value       = module.secrets.ring_api_token_secret_arn
}

output "demo_token_secret_arn" {
  description = "Secrets Manager ARN of the shared demo/review token (set its value out-of-band)."
  value       = module.secrets.demo_token_secret_arn
}

output "kms_key_arn" {
  description = "ARN of the project CMK."
  value       = module.secrets.kms_key_arn
}

output "function_names" {
  description = "Lambda function names keyed by short name."
  value       = module.lambdas.function_names
}

output "queue_urls" {
  description = "SQS work-queue URLs keyed by logical name."
  value       = module.queues.queue_urls
}

output "dashboard_name" {
  description = "Name of the source-to-action CloudWatch dashboard."
  value       = module.monitoring.dashboard_name
}

output "alarm_topic_arn" {
  description = "ARN of the alarm SNS topic (null when alarm_email is empty)."
  value       = module.monitoring.alarm_topic_arn
}
