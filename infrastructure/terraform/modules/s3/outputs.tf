output "bucket_name" {
  description = "Artifact bucket name."
  value       = aws_s3_bucket.artifacts.id
}

output "bucket_arn" {
  description = "Artifact bucket ARN."
  value       = aws_s3_bucket.artifacts.arn
}
