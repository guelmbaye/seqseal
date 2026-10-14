###############################################################################
# Secrets — project CMK + three Secrets Manager secret CONTAINERS.
#
# Secret VALUES are never written by Terraform (they would land in state).
# Set them out-of-band, see README.md:
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string '...'
#
# The CMK is also used by the DynamoDB tables and the artifact bucket, so it is
# exported and passed to those modules.
###############################################################################

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

resource "aws_kms_key" "this" {
  description             = "${var.name_prefix} data key (Secrets Manager, DynamoDB, S3 artifacts)"
  enable_key_rotation     = true # yearly automatic rotation
  deletion_window_in_days = var.kms_deletion_window_days

  # Default-equivalent key policy: the account root (and therefore IAM policies
  # in this account) controls the key. Service usage (DynamoDB, S3, Secrets
  # Manager) happens on behalf of the calling principal, whose IAM role carries
  # kms:Decrypt / kms:GenerateDataKey scoped to this key ARN.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableIamPoliciesForAccount"
        Effect = "Allow"
        Principal = {
          AWS = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
    ]
  })

  tags = merge(var.tags, {
    Name = var.name_prefix
  })
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.name_prefix}"
  target_key_id = aws_kms_key.this.key_id
}

locals {
  secrets = {
    ring_webhook_signing_secret = {
      name        = "ring-webhook-signing-secret"
      description = "HMAC signing secret used to verify Ring webhook deliveries (ring-ingest)."
    }
    ring_api_token = {
      name        = "ring-api-token"
      description = "Ring Developer Playground / partner API bearer token (ring-playground-adapter)."
    }
    demo_token = {
      name        = "demo-token"
      description = "Shared token required (x-seqseal-demo-token header) on demo and review endpoints."
    }
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.secrets

  name                    = "${var.name_prefix}/${each.value.name}"
  description             = each.value.description
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = var.recovery_window_in_days

  tags = merge(var.tags, {
    Name = "${var.name_prefix}/${each.value.name}"
  })
}
