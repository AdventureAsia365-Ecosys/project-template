output "ci_deploy_role_arn" {
  description = "Role the CI deploy job assumes (store it as a CI variable; do not commit it)"
  value       = aws_iam_role.ci_deploy.arn
}

output "account_id" {
  description = "Account the state belongs to (look it up here, never write it into docs)"
  value       = data.aws_caller_identity.current.account_id
}
