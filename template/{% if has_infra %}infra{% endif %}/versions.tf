terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72"
    }
  }

  # State backend: an S3 bucket with versioning and native locking. Create the bucket once (by hand or a bootstrap
  # root), then fill backend.hcl (not committed; see backend.hcl.example) and run: terraform init -backend-config=backend.hcl
  backend "s3" {}
}
