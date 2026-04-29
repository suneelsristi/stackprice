# stackprice

**AWS CDK infrastructure pricing estimation CLI — know what it costs before you deploy.**

[![npm version](https://img.shields.io/npm/v/stackprice)](https://npmjs.com/package/stackprice)
[![CI](https://github.com/suneelsristi/stackprice/actions/workflows/ci.yml/badge.svg)](https://github.com/suneelsristi/stackprice/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

`stackprice` is an open source CLI tool that reads your synthesized CDK output and
returns an itemized monthly cost estimate — per resource, per stack, and in total —
before a single dollar is spent.

This implementation is written by vibe-coding.

```bash
cdk synth
stackprice breakdown --dir ./cdk.out
```

```
Stack: ApiStack   Region: us-east-1
┌───────────────┬──────────────────────┬──────────────┐
│ Resource ID   │ Type                 │ Monthly Cost │
├───────────────┼──────────────────────┼──────────────┤
│ WebServer     │ AWS::EC2::Instance   │ $140.16      │
│ Database      │ AWS::RDS::DBInstance │ $12.41       │
│ NATGateway    │ AWS::EC2::NatGateway │ $32.85       │
├───────────────┴──────────────────────┼──────────────┤
│ Stack Subtotal                       │ $185.42      │
└──────────────────────────────────────┴──────────────┘
┌────────────┬───────────────────────┬─────────────────┬───────────────────────────────────────┐
│ Resource ID│ Type                  │ Unit Price      │ Note                                  │
├────────────┼───────────────────────┼─────────────────┼───────────────────────────────────────┤
│ NATGateway │ AWS::EC2::NatGateway  │ $0.04/unit      │ Usage-based — provide via --usage-file│
│ ApiHandler │ AWS::Lambda::Function │ $0.0000167/unit │ Usage-based — provide via --usage-file│
└────────────┴───────────────────────┴─────────────────┴───────────────────────────────────────┘

TOTAL ESTIMATED MONTHLY COST: $185.42 + usage-based
```

---

## Why stackprice

AWS CDK engineers have no open source way to estimate infrastructure costs before
deployment. You write CDK code, deploy, and discover the financial impact only when
the bill arrives.

`stackprice` fixes that. It plugs directly into your existing CDK workflow — no
registration, no external services, no changes to how you write CDK. Just run
`cdk synth` as you normally would, then point `stackprice` at the output.

---

## Installation

```bash
# Via npm (requires Node.js >= 20)
npm install -g stackprice

# Via npx (no install required)
npx stackprice breakdown --dir ./cdk.out
```

---

## Quick Start

```bash
# Synthesize your CDK app first
cdk synth

# Estimate all stacks
stackprice breakdown --dir ./cdk.out

# Estimate a specific stack only
stackprice breakdown --dir ./cdk.out --stack MyApiStack

# Output as JSON for CI/CD pipelines
stackprice breakdown --dir ./cdk.out --output json --out-file estimate.json

# One-line summary
stackprice breakdown --dir ./cdk.out --output summary

# Compare two cost estimates
stackprice diff before.json after.json
stackprice diff before.json after.json --format summary

# Provide usage estimates for Lambda, S3, NAT Gateway, etc.
stackprice breakdown --dir ./cdk.out --usage-file ./stackprice-usage.yml

# Generate a usage estimates file (no AWS credentials needed)
stackprice generate usage-file --dir ./cdk.out
```

---

## Credentials

`stackprice` uses the AWS Price List API to fetch pricing data. This API is
**free to call** and requires only one read-only permission.

**Minimum IAM permission required:**

```json
{
  "Effect": "Allow",
  "Action": ["pricing:GetProducts"],
  "Resource": "*"
}
```

`stackprice` uses the standard AWS credential chain. If you can run `cdk deploy`,
your credentials already work. No extra setup needed.

```bash
aws configure
```

Or:  `aws login`  (IAM Identity Center / SSO)

**Region resolution order:**

1. Region declared in the CDK template
2. `--region` flag
3. `AWS_DEFAULT_REGION` environment variable
4. `AWS_REGION` environment variable
5. Active AWS CLI profile region (`~/.aws/config`)
6. Falls back to `us-east-1` with a visible warning

---

## CLI Reference

### `stackprice breakdown`

Analyze a CDK cloud assembly and output pricing estimates.

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--dir` | string | `cdk.out` | Path to CDK cloud assembly directory |
| `--stack` | string | all | Name of specific stack to analyze |
| `--region` | string | from template | AWS region for pricing lookup |
| `--output` | enum | `table` | Output format: `table`, `json`, `summary` |
| `--out-file` | string | — | Write output to file instead of stdout |
| `--usage-file` | string | — | Path to YAML or JSON file with usage estimates |
| `--no-cache` | bool | false | Skip cache, always fetch fresh pricing |
| `--no-color` | bool | false | Disable color output |
| `--verbose` | bool | false | Show pricing API queries and resolution details |

### `stackprice diff`

Compare two breakdown JSON outputs and show cost delta per resource and in total.

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--format` | enum | `table` | Output format: `table`, `json`, `summary` |
| `--out-file` | string | — | Write output to file instead of stdout |
| `--no-color` | bool | false | Disable color output |

### `stackprice generate usage-file`

Generate a pre-populated usage estimates file from your CDK cloud assembly.
**Does not require AWS credentials.**

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--dir` | string | `cdk.out` | Path to CDK cloud assembly directory |
| `--stack` | string | all | Filter to a specific stack |
| `--format` | enum | `yaml` | Output format: `yaml` or `json` |
| `--out-file` | string | auto | Output file path |
| `--force` | bool | false | Overwrite existing file |
| `--types` | string | all | Comma-separated types: `Lambda,S3,SQS,SNS,ApiGateway,NatGateway,CloudFront` |

---

## Usage File

Usage-based resources (Lambda, S3, SQS, SNS, API Gateway, NAT Gateway, CloudFront)
show unit prices only by default. Provide a usage file to get estimated monthly costs.

**Generate a starter file (easiest approach):**

```bash
stackprice generate usage-file --dir ./cdk.out
# Creates stackprice-usage.yml with all usage-based resources pre-populated
```

**Or write it manually (YAML):**

```yaml
# stackprice-usage.yml
ApiHandler5E7490E8:
  requests_per_month: 5000000   # Lambda invocations per month
  avg_duration_ms: 200          # average duration in milliseconds
  memory_mb: 256                # memory in MB (optional, defaults to 128)

DataBucketE3889A50:
  storage_gb: 500               # GB stored per month

VPCPublicSubnet1NATGateway:
  data_transfer_gb: 1000        # GB processed per month
  # Fixed hourly cost ($32.85/month) included automatically

MyApi49610EDF:
  requests_per_month: 2000000   # API Gateway REST API calls per month

MyDistribution:
  monthly_requests: 10000000    # CloudFront requests per month
  monthly_transfer_gb: 100      # GB transferred to users (US zone pricing)
```

**JSON format is also supported:**

```json
{
  "ApiHandler5E7490E8": {
    "requests_per_month": 5000000,
    "avg_duration_ms": 200,
    "memory_mb": 256
  },
  "DataBucketE3889A50": {
    "storage_gb": 500
  }
}
```

Usage file keys can use either the full logical ID (`ApiHandler5E7490E8`) or
the display name without the CDK hash suffix (`ApiHandler`) — both work.

Run with:
```bash
stackprice breakdown --dir ./cdk.out --usage-file ./stackprice-usage.yml
```

Estimates use Tier 1 pricing. Actual costs may be lower at high volume due to
AWS tiered pricing discounts.

---

## CI Integration

Add cost estimates or cost diffs as comments on every pull request using GitHub
Actions — no extra services or accounts required.

```yaml
# .github/workflows/cost.yml
- name: Estimate cost
  run: stackprice breakdown --dir ./cdk.out --output json --out-file estimate.json
```

See [CI Integration](docs/ci-integration.md) for complete workflow recipes including
cost diff on PRs.

---

## Supported AWS Resources

| Resource Type | Pricing Model |
| --- | --- |
| `AWS::EC2::Instance` | Fixed (on-demand hourly × 730 hrs/month) |
| `AWS::RDS::DBInstance` | Fixed (instance hourly × 730 hrs/month + storage per GB-month †) |
| `AWS::ECS::TaskDefinition` | Fixed (Fargate vCPU + memory × 730 hrs/month) |
| `AWS::DynamoDB::Table` | Fixed (provisioned) or Usage-based (on-demand) |
| `AWS::ElastiCache::CacheCluster` | Fixed (on-demand hourly × 730 hrs/month) |
| `AWS::EKS::Cluster` | Fixed (control plane $0.10/hr × 730 hrs/month) |
| `AWS::SecretsManager::Secret` | Fixed ($0.40/secret/month) |
| `AWS::EC2::NatGateway` | Mixed — Fixed ($0.045/hr) + Usage-based ($0.045/GB processed) |
| `AWS::Lambda::Function` | Usage-based (invocations × duration × memory) |
| `AWS::S3::Bucket` | Usage-based (storage per GB) |
| `AWS::SQS::Queue` | Usage-based (requests) |
| `AWS::SNS::Topic` | Usage-based (notifications) |
| `AWS::ApiGateway::RestApi` | Usage-based (REST API calls, Tier 1 rate) |
| `AWS::CloudFront::Distribution` | Usage-based (requests + data transfer, US zone) |
| `AWS::Kinesis::Stream` | Fixed (provisioned: $0.015/shard-hour × shards × 730; on-demand: $0.04/stream-hour × 730) |
| `AWS::Logs::LogGroup` | Usage-based (ingestion $0.50/GB + storage $0.03/GB-month †) |
| `AWS::KinesisFirehose::DeliveryStream` | Usage-based (Direct PUT ingestion $0.08/GB) |
| `AWS::StepFunctions::StateMachine` | Usage-based (Standard: $0.000025/transition; Express: per-request + duration) |

† RDS storage cost uses hardcoded rates verified 2026-04-24.
  See [AWS RDS Pricing](https://aws.amazon.com/rds/pricing/) for current rates.

† CloudWatch Logs storage rate ($0.03/GB-month) uses a hardcoded
  rate verified 2026-04-24. See
  [AWS CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)
  for current rates.

Unsupported resource types are skipped with a warning and listed at the end of output.
They never cause the tool to fail.

---

## CloudFormation Conditions

If your CDK app uses CloudFormation Conditions to toggle resources on or off,
`stackprice` handles them safely:

- Conditioned resources are **excluded from the cost total**
- They are shown in a separate section with their condition name
- Condition evaluation is planned for a future release

---

## How It Works

1. Reads `cdk.out/manifest.json` to discover all stacks in your app
2. Parses each CloudFormation template JSON file
3. Resolves the AWS region using the standard credential chain
4. Queries the AWS Price List API in parallel for each resource type
5. Caches responses locally for 24 hours to avoid redundant API calls
6. Outputs a cost breakdown sorted by monthly cost (highest first)

`stackprice` never reads your deployed resources, never modifies your infrastructure,
and never sends your template data to any external service. All processing is local.

---

## Roadmap

**Shipped:** see [CHANGELOG](CHANGELOG.md) for the full history of v0.1.0 through v0.7.0.

**Planned:**

| Version | Feature |
| --- | --- |
| v0.8.0 | GitHub Action — `suneelsristi/stackprice-action` for PR comments |
| v0.8.0 | RDS IOPS pricing (io1/io2) |
| v0.8.0 | AWS::EC2::EIP — pending Pricing API availability |
| v1.0.0 | Native CloudFormation template support (outside CDK) |
| v1.0.0 | VS Code extension with inline cost annotations |

---

## Contributing

Contributions are welcome. For significant changes, open an issue first to discuss
the approach.

**Branch workflow:**

- `main` — stable, protected
- `feature/xxx` — new features
- `bugfix/xxx` — bug fixes
- `chore/xxx` — tooling and config

---

## License

[MIT](LICENSE) — free for personal and commercial use.

---

Built with [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3),
[commander.js](https://github.com/tj/commander.js),
[cli-table3](https://github.com/cli-table/cli-table3), and
[chalk](https://github.com/chalk/chalk).
Implementation written with Claude Code.
