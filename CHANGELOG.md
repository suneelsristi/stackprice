# Changelog

All notable changes to stackprice are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com).

## [0.6.0] - 2026-04-24

### Added
- AWS::Kinesis::Stream handler — supports both PROVISIONED
  (per-shard hourly, $0.015/shard-hour) and ON_DEMAND
  (per-stream hourly, $0.04/stream-hour) capacity modes.
  ShardCount and StreamMode read from CDK template.
- CDK internal Lambda functions now excluded from
  stackprice generate usage-file output. Framework-managed
  Lambdas (e.g. CustomResource providers) no longer appear
  in generated usage estimate files.

### Changed
- RDS handler now includes storage cost in the monthly total.
  AllocatedStorage and StorageType are read from the CDK
  template. Storage rates are hardcoded (see disclaimer in
  output) and cover gp2, gp3, io1, io2, and standard storage
  types for both Single-AZ and Multi-AZ deployments.
  Example: db.t3.micro with 20GB gp2 Single-AZ now shows
  $14.71/month ($12.41 instance + $2.30 storage) instead
  of $12.41/month.
- Table output now shows a † disclaimer when RDS resources
  are priced, noting that storage rates are hardcoded and
  linking to the AWS RDS pricing page for verification.

### Known Limitations
- RDS io1/io2 IOPS charges are not included — only storage
  GB cost. IOPS pricing requires a separate Pricing API
  query and is deferred to a future release.
- Kinesis Extended Retention and Enhanced Fan-Out charges
  are not included — only base shard/stream-hour cost.

## [0.5.0] - 2026-04-23

### Added
- `stackprice generate usage-file` command — generates a pre-populated
  YAML or JSON usage estimates file from the CDK cloud assembly without
  requiring AWS credentials. Supports --stack, --format, --out-file,
  --force, and --types flags.
- AWS::EC2::NatGateway handler — first mixed pricingType handler.
  Fixed hourly cost ($0.045/hr = $32.85/month) shown in fixed cost
  table. Data processing ($0.045/GB) shown in usage-based table.
  Provide data_transfer_gb in --usage-file for estimated data costs.
- AWS::CloudFront::Distribution handler — usage-based pricing using
  US zone Tier 1 rates ($0.00000075/request). Provide monthly_requests
  and monthly_transfer_gb in --usage-file for full cost estimate.
- Section headings in table output — bold ▸ labels before each table
  section (Fixed monthly costs, Usage-based resources, Estimated costs,
  Conditioned resources) for clarity when multiple sections are present.

### Changed
- pricingType enum replaces isUsageBased boolean across the entire
  codebase. Handlers now declare pricingType: 'fixed', 'usage-based',
  or 'mixed'. Mixed handlers implement both buildPricingQuery (fixed
  component) and buildUsagePricingQuery (usage-based component).
- Usage file matching now accepts both full logical IDs
  (ApiHandler5E7490E8) and display names without the CDK hash suffix
  (ApiHandler) — both resolve correctly.
- parseUsageFile whitelist extended: data_transfer_gb,
  monthly_requests, monthly_transfer_gb added.
- stripCdkHash extracted to src/utils/string.ts — shared between
  table formatter and pricing engine.

### Fixed
- Usage file entries keyed by stripped logical ID (display name) now
  correctly match resources whose full ID has a CDK hash suffix.
  Previously these were silently ignored.

## [0.4.0] - 2026-04-22

### Added
- AWS::SecretsManager::Secret handler — fixed cost at $0.40/secret/month.
  Appears correctly priced on virtually every CDK stack that uses RDS,
  Aurora, or any other secret-backed resource.
- AWS::EKS::Cluster handler — fixed cost at $0.10/hour ($73.00/month)
  for the EKS control plane. Excludes Outposts variants.
- --usage-file now accepts JSON in addition to YAML. File format is
  detected by extension (.json → JSON.parse, .yml/.yaml → js-yaml).
  Unrecognised extensions throw a clear error message.

### Fixed
- CRITICAL: EU region pricing broken since v0.1.0. The AWS Pricing API
  uses "EU (Ireland)", "EU (London)", "EU (Frankfurt)" etc. — not
  "Europe (Ireland)" as previously mapped. Any user with stacks in
  eu-west-1, eu-west-2, eu-central-1, eu-west-3, eu-north-1, or
  eu-south-1 was receiving no pricing results for any resource.
  All EU location strings corrected.

### Changed
- REGION_TO_LOCATION map expanded from 13 to 38 regions. New regions
  added: eu-west-3, eu-central-2, eu-north-1, eu-south-1, eu-south-2,
  ap-southeast-3 through ap-southeast-6, ap-northeast-2, ap-northeast-3,
  ap-south-2, ap-east-1, ap-east-2, ca-west-1, af-south-1, me-south-1,
  me-central-1, il-central-1, mx-central-1, us-gov-east-1, us-gov-west-1.

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
