terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# NOTE: this root module intentionally declares NO provider "aws" block so it can
# be consumed as a module (see environments/<env>/main.tf). The caller owns the
# provider configuration (region, credentials, default_tags).
