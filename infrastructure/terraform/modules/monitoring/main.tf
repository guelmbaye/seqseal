###############################################################################
# Monitoring — DLQ alarms, Lambda error alarms, optional SNS e-mail, and the
# "source-to-action" dashboard (Ring event -> verdict -> operational action).
###############################################################################

data "aws_region" "current" {}

locals {
  region       = data.aws_region.current.name
  create_sns   = var.alarm_email != ""
  alarm_action = local.create_sns ? [aws_sns_topic.alarms[0].arn] : []

  # Every DLQ: one per work queue + the shared EventBridge target DLQ.
  all_dlq_names = merge(var.dlq_names, {
    eventbridge = var.eventbridge_dlq_name
  })

  dashboard_function_keys = [for k in var.dashboard_function_keys : k if contains(keys(var.function_names), k)]

  custom_metrics = [
    "WorkflowReleased",
    "WorkflowHeld",
    "WorkflowReviewRequired",
    "WorkflowAwaitingEvidence",
    "SystemError",
  ]

  logs_insights_sources = join(" | ", [
    for k in local.dashboard_function_keys : "SOURCE '/aws/lambda/${var.function_names[k]}'"
  ])
}

###############################################################################
# Optional notification channel
###############################################################################

# Not KMS-encrypted on purpose: CloudWatch alarms cannot publish to a topic
# encrypted with the AWS-managed alias/aws/sns key, and alarm payloads carry
# no sensitive data (metric names and thresholds only).
resource "aws_sns_topic" "alarms" {
  count = local.create_sns ? 1 : 0

  name = "${var.name_prefix}-alarms"

  tags = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  count = local.create_sns ? 1 : 0

  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

###############################################################################
# Alarms
###############################################################################

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  for_each = local.all_dlq_names

  alarm_name          = "${each.value}-not-empty"
  alarm_description   = "Messages landed in DLQ ${each.value}: a pipeline stage failed repeatedly. Inspect, fix, then redrive."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = each.value
  }

  alarm_actions = local.alarm_action
  ok_actions    = local.alarm_action

  tags = var.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = var.function_names

  alarm_name          = "${each.value}-errors"
  alarm_description   = "Lambda ${each.value} reported errors in the last 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = local.alarm_action
  ok_actions    = local.alarm_action

  tags = var.tags
}

###############################################################################
# Dashboard
###############################################################################

locals {
  # Three Lambda widgets per row; everything else stacks below them.
  base_y = ceil(length(local.dashboard_function_keys) / 3) * 6

  lambda_widgets = [
    for i, k in local.dashboard_function_keys : {
      type   = "metric"
      x      = (i % 3) * 8
      y      = floor(i / 3) * 6
      width  = 8
      height = 6
      properties = {
        title   = "${k}: invocations / errors"
        region  = local.region
        view    = "timeSeries"
        stacked = false
        period  = 60
        stat    = "Sum"
        metrics = [
          ["AWS/Lambda", "Invocations", "FunctionName", var.function_names[k], { label = "Invocations" }],
          ["AWS/Lambda", "Errors", "FunctionName", var.function_names[k], { label = "Errors", color = "#d62728" }],
        ]
      }
    }
  ]

  queue_widget = {
    type   = "metric"
    x      = 0
    y      = local.base_y
    width  = 12
    height = 6
    properties = {
      title   = "SQS: visible messages per queue"
      region  = local.region
      view    = "timeSeries"
      stacked = false
      period  = 60
      stat    = "Maximum"
      metrics = [
        for k, name in var.queue_names : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", name, { label = k }]
      ]
    }
  }

  outcome_widget = {
    type   = "metric"
    x      = 12
    y      = local.base_y
    width  = 12
    height = 6
    properties = {
      title   = "SEQSEAL outcomes (${var.environment})"
      region  = local.region
      view    = "timeSeries"
      stacked = false
      period  = 300
      stat    = "Sum"
      metrics = [
        for m in local.custom_metrics : [var.metric_namespace, m, "Environment", var.environment, { label = m }]
      ]
    }
  }

  dlq_widget = {
    type   = "metric"
    x      = 0
    y      = local.base_y + 6
    width  = 24
    height = 4
    properties = {
      title   = "Dead-letter queues (must stay at 0)"
      region  = local.region
      view    = "singleValue"
      stacked = false
      period  = 60
      stat    = "Maximum"
      metrics = [
        for k, name in local.all_dlq_names : ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", name, { label = k }]
      ]
    }
  }

  logs_widget = {
    type   = "log"
    x      = 0
    y      = local.base_y + 10
    width  = 24
    height = 8
    properties = {
      title  = "Source-to-action trace (correlation_id / execution_id)"
      region = local.region
      view   = "table"
      query  = "${local.logs_insights_sources} | fields @timestamp, correlation_id, execution_id, msg, level, service | filter ispresent(correlation_id) | sort @timestamp desc | limit 200"
    }
  }
}

resource "aws_cloudwatch_dashboard" "source_to_action" {
  dashboard_name = "${var.name_prefix}-source-to-action"

  dashboard_body = jsonencode({
    widgets = concat(
      local.lambda_widgets,
      [
        local.queue_widget,
        local.outcome_widget,
        local.dlq_widget,
      ],
      length(local.dashboard_function_keys) > 0 ? [local.logs_widget] : [],
    )
  })
}
