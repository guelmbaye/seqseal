###############################################################################
# S3 — artifact bucket (media captures, evaluation snapshots, receipts).
# Private, versioned, SSE-KMS, TLS-only, owner-enforced.
###############################################################################

resource "aws_s3_bucket" "artifacts" {
  bucket        = "${var.name_prefix}-artifacts-${var.account_id}"
  force_destroy = var.force_destroy

  tags = merge(var.tags, {
    Name = "${var.name_prefix}-artifacts-${var.account_id}"
  })
}

resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  # Lifecycle rules on a versioned bucket must wait for versioning to be set.
  depends_on = [aws_s3_bucket_versioning.artifacts]

  rule {
    id     = "expire-raw-media"
    status = "Enabled"

    filter {
      prefix = "media/"
    }

    expiration {
      days = var.media_expiration_days
    }
  }

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    # Empty filter = applies to the whole bucket.
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      },
    ]
  })

  # Public-access block must exist first, otherwise PutBucketPolicy can race it.
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}
