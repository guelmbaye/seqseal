###############################################################################
# EventBridge — custom bus, archive, routing rules -> SQS, and the queue
# policies that authorize exactly those rules.
#
# Lambdas publish with Source = var.event_source ("seqseal"),
# DetailType = event_type (e.g. "seqseal.evidence.accepted"), Detail = JSON.
# Each rule matches source + a list of detail-types and targets ONE queue.
###############################################################################

resource "aws_cloudwatch_event_bus" "this" {
  name = "${var.name_prefix}-events"

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-events"
  })
}

resource "aws_cloudwatch_event_archive" "this" {
  count = var.archive_retention_days > 0 ? 1 : 0

  name             = "${var.name_prefix}-events-archive"
  description      = "Replayable archive of every event on ${aws_cloudwatch_event_bus.this.name}."
  event_source_arn = aws_cloudwatch_event_bus.this.arn
  retention_days   = var.archive_retention_days
}

# Shared DLQ for events EventBridge could not deliver to a target queue.
resource "aws_sqs_queue" "eventbridge_dlq" {
  name                      = "${var.name_prefix}-eventbridge-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-eventbridge-dlq"
    Role = "dlq"
  })
}

resource "aws_cloudwatch_event_rule" "route" {
  for_each = var.routes

  name           = "${var.name_prefix}-route-${each.key}"
  description    = "Route ${join(", ", each.value)} to ${each.key}."
  event_bus_name = aws_cloudwatch_event_bus.this.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source        = [var.event_source]
    "detail-type" = each.value
  })

  tags = merge(var.tags, {
    Name  = "${var.name_prefix}-route-${each.key}"
    Queue = each.key
  })
}

resource "aws_cloudwatch_event_target" "route" {
  for_each = var.routes

  event_bus_name = aws_cloudwatch_event_bus.this.name
  rule           = aws_cloudwatch_event_rule.route[each.key].name
  target_id      = "sqs-${each.key}"
  arn            = var.queue_arns[each.key]

  retry_policy {
    maximum_event_age_in_seconds = var.target_max_event_age_seconds
    maximum_retry_attempts       = var.target_max_retry_attempts
  }

  dead_letter_config {
    arn = aws_sqs_queue.eventbridge_dlq.arn
  }

  # Queue policies must exist before EventBridge starts delivering.
  depends_on = [
    aws_sqs_queue_policy.route,
    aws_sqs_queue_policy.eventbridge_dlq,
  ]
}

# Each target queue accepts SendMessage from events.amazonaws.com ONLY when the
# request originates from the specific rule that routes to it.
resource "aws_sqs_queue_policy" "route" {
  for_each = var.routes

  queue_url = var.queue_urls[each.key]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgeRule"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = var.queue_arns[each.key]
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.route[each.key].arn
          }
        }
      },
    ]
  })
}

resource "aws_sqs_queue_policy" "eventbridge_dlq" {
  queue_url = aws_sqs_queue.eventbridge_dlq.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgeRuleDeadLetters"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.eventbridge_dlq.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = [for r in aws_cloudwatch_event_rule.route : r.arn]
          }
        }
      },
    ]
  })
}
