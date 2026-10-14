###############################################################################
# SQS — one work queue per pipeline stage, each with its own DLQ.
#
# Encryption: SSE-SQS (sqs_managed_sse_enabled). This is deliberate: EventBridge
# can deliver to SSE-SQS queues without any KMS key-policy plumbing, and no
# message body carries secrets (events reference evidence by id).
#
# Queue *policies* (who may SendMessage) are NOT defined here: they live in
# modules/event-bus next to the EventBridge rules they authorize, so each policy
# can pin aws:SourceArn to the concrete rule ARN without a module cycle
# (queues -> event-bus is the only direction).
###############################################################################

resource "aws_sqs_queue" "dlq" {
  for_each = var.queues

  name                      = "${var.name_prefix}-${each.key}-dlq"
  message_retention_seconds = var.dlq_message_retention_seconds
  sqs_managed_sse_enabled   = true

  tags = merge(var.tags, {
    Name  = "${var.name_prefix}-${each.key}-dlq"
    Queue = each.key
    Role  = "dlq"
  })
}

resource "aws_sqs_queue" "this" {
  for_each = var.queues

  name                       = "${var.name_prefix}-${each.key}"
  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  delay_seconds              = each.value.delay_seconds
  message_retention_seconds  = var.message_retention_seconds
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = merge(var.tags, {
    Name  = "${var.name_prefix}-${each.key}"
    Queue = each.key
    Role  = "work"
  })
}

# Only the matching work queue may use a DLQ as its dead-letter target.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  for_each = var.queues

  queue_url = aws_sqs_queue.dlq[each.key].id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this[each.key].arn]
  })
}
