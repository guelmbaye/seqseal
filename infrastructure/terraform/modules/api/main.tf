###############################################################################
# API Gateway HTTP API (v2) — Ring webhook, Playground capture, read/review/demo
# endpoints. Lambda proxy integrations (payload format 2.0), $default stage.
#
# Authentication is enforced in the handlers:
#   - ring-ingest verifies the Ring HMAC signature (signing secret)
#   - review/demo/playground endpoints require the x-seqseal-demo-token header
###############################################################################

locals {
  # Distinct integrated functions (one integration + one permission each).
  integrated_functions = toset([for r in values(var.routes) : r.function])
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name_prefix}-api"
  retention_in_days = var.log_retention_days

  tags = var.tags
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-api"
  description   = "SEQSEAL HTTP API (${var.name_prefix})"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-seqseal-demo-token"]
    max_age       = 3600
  }

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-api"
  })
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each = local.integrated_functions

  api_id                 = aws_apigatewayv2_api.this.id
  description            = "Lambda proxy to ${var.function_names[each.key]}"
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = var.invoke_arns[each.key]
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}

resource "aws_apigatewayv2_route" "this" {
  for_each = var.routes

  api_id    = aws_apigatewayv2_api.this.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[each.value.function].id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      ip               = "$context.identity.sourceIp"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      protocol         = "$context.protocol"
      responseLength   = "$context.responseLength"
      latency          = "$context.responseLatency"
      integrationError = "$context.integrationErrorMessage"
    })
  }

  tags = var.tags
}

resource "aws_lambda_permission" "api" {
  for_each = local.integrated_functions

  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.function_names[each.key]
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
