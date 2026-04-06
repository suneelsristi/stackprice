# Changelog

All notable changes to stackprice are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com).

## [0.1.0] - 2026-04-05

### Added
- Pricing support for 8 AWS resource types: EC2, RDS, Lambda,
  S3, DynamoDB (provisioned + on-demand), ECS Fargate, SQS, SNS
- Three output formats: table, JSON, summary
- CloudFormation Conditions handling — conditioned resources
  excluded from total, shown in separate table (ADR-011)
- Two-layer pricing cache — in-memory + file with 24h TTL
- Full region resolution chain (ADR-008)
- Startup credential check with actionable error message (ADR-010)
- CDK v1 detection via runtimeInfo.libraries (ADR-007)

## [Unreleased]

### Planned for v0.2.0
- stackprice diff — cost delta between two estimates
- GitHub Actions integration — PR cost comments
- --conditions flag — evaluate CloudFormation Conditions
- Expanded resource coverage: ElastiCache, EKS, CloudFront,
  API Gateway
