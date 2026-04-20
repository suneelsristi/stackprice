# Changelog

All notable changes to stackprice are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com).

## [0.3.0] - 2026-04-20

### Added
- `--usage-file` flag — provide a YAML file with monthly usage
  estimates for Lambda, S3, SQS, SNS, and API Gateway resources.
  Estimated costs appear in a dedicated table section and are
  included in the stack total. Uses Tier 1 pricing with a
  disclaimer that actual costs may be lower at high volume.
- AWS::ApiGateway::RestApi handler — per-request pricing now
  correctly fetched via productFamily="API Calls" filter.
  Previously blocked due to wrong filter field.

### Fixed
- Tier 1 pricing for all tiered services — Lambda, SQS, and
  API Gateway were previously returning incorrect lower-tier
  prices. All usage-based resources now show the standard
  Tier 1 rate (beginRange=0).
- API Gateway pricing filter — was using non-existent
  group="Amazon API Gateway - Requests" field. Correct filter
  is productFamily="API Calls".

### Changed
- Resource IDs in table output now strip the 8-character CDK
  hash suffix for readability (e.g. "WebServer99EDD300" displays
  as "WebServer"). Full IDs preserved in JSON output.
- Usage-based resources table sorted by unit price descending.
- Total line rendered in bold green.
- Error messages rendered in red (StackPriceError).
- Region fallback warning rendered in yellow.

### Known Issues
- Error messages for directory-not-found and similar errors
  appear without color due to commander.js intercepting them
  before the chalk handler runs. Tracked in issue #XX.

## [0.2.0] - 2026-04-18

### Added
- `stackprice diff` — compare two breakdown JSON outputs and
  show cost delta per resource and in total, with both absolute
  and percentage changes. Supports table, JSON, and summary
  output formats.
- ElastiCache handler — AWS::ElastiCache::CacheCluster
  (Redis and Memcached, single and multi-node clusters)
- CI integration docs — GitHub Actions workflow recipes for
  cost estimates and cost diffs on pull requests
  (see docs/ci-integration.md)

### Known Limitations
- AWS::ApiGateway::RestApi cannot be priced via the AWS Price
  List API — the per-request pricing is not exposed through
  GetProducts. See GitHub issue #38 for full analysis.
  Planned fix in v0.3.0 using AWS bulk pricing files.

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
