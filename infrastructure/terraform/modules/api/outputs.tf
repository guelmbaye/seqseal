output "api_id" {
  description = "HTTP API id."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Base URL of the HTTP API ($default stage), e.g. https://abc123.execute-api.<region>.amazonaws.com."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "execution_arn" {
  description = "Execution ARN of the HTTP API."
  value       = aws_apigatewayv2_api.this.execution_arn
}

output "access_log_group_name" {
  description = "Name of the API access log group."
  value       = aws_cloudwatch_log_group.access.name
}

output "route_keys" {
  description = "Configured route keys."
  value       = keys(aws_apigatewayv2_route.this)
}
