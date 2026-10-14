###############################################################################
# DynamoDB — four single-table-design tables (string pk / string sk).
# On-demand billing, PITR, SSE with the project CMK.
###############################################################################

locals {
  tables = {
    executions = {
      ttl_attribute = null
    }
    evidence = {
      ttl_attribute = null
    }
    config = {
      ttl_attribute = null
    }
    idempotency = {
      ttl_attribute = "expires_at"
    }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.tables

  name                        = "${var.name_prefix}-${each.key}"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  dynamic "ttl" {
    for_each = each.value.ttl_attribute == null ? [] : [each.value.ttl_attribute]

    content {
      attribute_name = ttl.value
      enabled        = true
    }
  }

  tags = merge(var.tags, {
    Name  = "${var.name_prefix}-${each.key}"
    Table = each.key
  })
}
