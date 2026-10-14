###############################################################################
# Lambdas — functions, log groups, SQS event source mappings, scheduled sweeper.
#
# Bundles are produced by `pnpm build:lambdas` as
#   <artifacts_dir>/<name>/dist/<name>.zip
# and must exist at plan time (filebase64sha256 reads them).
###############################################################################

locals {
  zip_paths = {
    for k, _ in var.functions : k => "${var.artifacts_dir}/${k}/dist/${k}.zip"
  }

  # One event source mapping per (function, queue) pair; sequence-evaluator has two.
  event_source_mappings = {
    for pair in flatten([
      for fn, f in var.functions : [
        for q in f.queues : {
          key      = "${fn}--${q}"
          function = fn
          queue    = q
        }
      ]
    ]) : pair.key => pair
  }

  scheduled_functions = {
    for k, f in var.functions : k => f if f.schedule_expression != null
  }
}

resource "aws_cloudwatch_log_group" "this" {
  for_each = var.functions

  name              = "/aws/lambda/${var.function_names[each.key]}"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, {
    Function = each.key
  })
}

resource "aws_lambda_function" "this" {
  for_each = var.functions

  function_name = var.function_names[each.key]
  description   = each.value.description
  role          = var.role_arns[each.key]

  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"

  filename         = local.zip_paths[each.key]
  source_code_hash = filebase64sha256(local.zip_paths[each.key])

  memory_size = each.value.memory
  timeout     = each.value.timeout

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = merge(var.environment_variables, {
      SEQSEAL_FUNCTION = each.key
    })
  }

  tags = merge(var.tags, {
    Name     = var.function_names[each.key]
    Function = each.key
    Trigger  = each.value.trigger
  })

  # Create the log group with its retention first, so Lambda does not create
  # an unmanaged, never-expiring one on first invocation.
  depends_on = [aws_cloudwatch_log_group.this]
}

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = local.event_source_mappings

  event_source_arn = var.queue_arns[each.value.queue]
  function_name    = aws_lambda_function.this[each.value.function].arn

  enabled                            = true
  batch_size                         = 1
  maximum_batching_window_in_seconds = 0
  function_response_types            = ["ReportBatchItemFailures"]
}

###############################################################################
# Scheduled functions (execution-sweeper): default event bus, rate rule.
###############################################################################

resource "aws_cloudwatch_event_rule" "schedule" {
  for_each = local.scheduled_functions

  name                = "${var.function_names[each.key]}-schedule"
  description         = "Invoke ${var.function_names[each.key]} on ${each.value.schedule_expression}."
  schedule_expression = each.value.schedule_expression
  state               = "ENABLED"

  tags = merge(var.tags, {
    Function = each.key
  })
}

resource "aws_cloudwatch_event_target" "schedule" {
  for_each = local.scheduled_functions

  rule      = aws_cloudwatch_event_rule.schedule[each.key].name
  target_id = "lambda-${each.key}"
  arn       = aws_lambda_function.this[each.key].arn

  retry_policy {
    maximum_event_age_in_seconds = 300
    maximum_retry_attempts       = 2
  }
}

resource "aws_lambda_permission" "schedule" {
  for_each = local.scheduled_functions

  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[each.key].arn
}
