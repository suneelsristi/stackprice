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
├───────────────┴──────────────────────┼──────────────┤
│ Stack Subtotal                       │ $152.57      │
└──────────────────────────────────────┴──────────────┘
┌───────────────┬──────────────────────┬─────────────────┬──────────────────────────────────────────────────┐
│ Resource ID   │ Type                 │ Unit Price      │ Note                                             │
├───────────────┼──────────────────────┼─────────────────┼──────────────────────────────────────────────────┤
│ ApiHandler    │ AWS::Lambda::Function│ $0.0000167/unit │ Usage-based — provide estimate via --usage-file  │
│ DataBucket    │ AWS::S3::Bucket      │ $0.02/unit      │ Usage-based — provide estimate via --usage-file  │
└───────────────┴──────────────────────┴─────────────────┴──────────────────────────────────────────────────┘

TOTAL ESTIMATED MONTHLY COST: $152.57 + usage-based
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

# Provide usage estimates for Lambda, S3, SQS, SNS, API Gateway
stackprice breakdown --dir ./cdk.out --usage-file ./stackprice-usage.yml
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
Or:  aws login      (IAM Identity Center / SSO)

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
|---|---|---|---|
| `--dir` | string | `cdk.out` | Path to CDK cloud assembly directory |
| `--stack` | string | all | Name of specific stack to analyze |
| `--region` | string | from template | AWS region for pricing lookup |
| `--output` | enum | `table` | Output format: `table`, `json`, `summary` |
| `--out-file` | string | — | Write output to file instead of stdout |
| `--no-cache` | bool | false | Skip cache, always fetch fresh pricing |
| `--no-color` | bool | false | Disable color output |
| `--verbose` | bool | false | Show pricing API queries and resolution details |
| `--usage-file` | string | — | Path to YAML or JSON file with usage estimates for usage-based resources |

### `stackprice diff`

Compare two breakdown JSON outputs and show cost delta per resource
and in total.

| Flag | Type | Default | Description |
|---|---|---|---|
| `--format` | enum | `table` | Output format: `table`, `json`, `summary` |
| `--out-file` | string | — | Write output to file instead of stdout |
| `--no-color` | bool | false | Disable color output |

---

## Usage File

Usage-based resources (Lambda, S3, SQS, SNS, API Gateway) show
unit prices only by default. Provide a YAML file to get estimated
monthly costs:

```yaml
# stackprice-usage.yml
# Keys are logical resource IDs from your CDK template

ApiHandler5E7490E8:
  requests_per_month: 5000000   # Lambda invocations per month
  avg_duration_ms: 200          # average duration in milliseconds
  memory_mb: 256                # memory in MB (optional, defaults to 128)

DataBucketE3889A50:
  storage_gb: 500               # GB stored per month

JobQueueEE3AD499:
  requests_per_month: 10000000  # SQS requests per month

AlertTopic2720D535:
  requests_per_month: 1000000   # SNS notifications per month

MyApi49610EDF:
  requests_per_month: 2000000   # API Gateway REST API calls per month
```

JSON format is also supported:
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

Run with:
```bash
stackprice breakdown --dir ./cdk.out --usage-file ./stackprice-usage.yml
```

Estimates use Tier 1 pricing. Actual costs may be lower at high
volume due to AWS tiered pricing discounts.

---

## CI Integration

Add cost estimates or cost diffs as comments on every pull request
using GitHub Actions — no extra services or accounts required.

```yaml
# .github/workflows/cost.yml
- name: Estimate cost
  run: stackprice breakdown --dir ./cdk.out --output json --out-file estimate.json
```

See [CI Integration](docs/ci-integration.md) for complete workflow
recipes including cost diff on PRs.

## Supported AWS Resources

| Resource Type | Pricing Model |
|---|---|
| `AWS::EC2::Instance` | Fixed (on-demand hourly × 730 hrs/month) |
| `AWS::RDS::DBInstance` | Fixed (on-demand hourly × 730 hrs/month) |
| `AWS::Lambda::Function` | Usage-based (invocations + duration) |
| `AWS::S3::Bucket` | Usage-based (storage + requests) |
| `AWS::DynamoDB::Table` | Fixed (provisioned) or Usage-based (on-demand) |
| `AWS::ECS::TaskDefinition` | Fixed (Fargate vCPU + memory) |
| `AWS::SQS::Queue` | Usage-based (requests) |
| `AWS::SNS::Topic` | Usage-based (notifications) |
| `AWS::ElastiCache::CacheCluster` | Fixed (on-demand hourly x 730 hrs/month) |
| `AWS::ApiGateway::RestApi` | Usage-based (REST API calls, Tier 1 rate) |
| `AWS::SecretsManager::Secret` | Fixed ($0.40/secret/month) |
| `AWS::EKS::Cluster` | Fixed (control plane $0.10/hour × 730 hrs/month) |

Unsupported resource types are skipped with a warning and listed at the end of output.
They never cause the tool to fail.

---

## CloudFormation Conditions

If your CDK app uses CloudFormation Conditions to toggle resources on or off,
`stackprice` handles them safely:

- Conditioned resources are **excluded from the cost total**
- They are shown in a separate section with their unit cost and condition name
- Condition evaluation is planned for a future release.

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

| Version | Feature | Status |
|---|---|---|
| v0.1.0 | Core pricing engine — EC2, RDS, Lambda, S3, DynamoDB, ECS, SQS, SNS | ✅ shipped |
| v0.1.1 | Bug fixes — credentials error message, trailing zeros, CDK internal Lambdas | ✅ shipped |
| v0.2.0 | `stackprice diff` — cost delta between two estimates | ✅ shipped |
| v0.2.0 | ElastiCache support | ✅ shipped |
| v0.2.0 | GitHub Actions CI integration docs | ✅ shipped |
| v0.3.0 | API Gateway support | ✅ shipped |
| v0.3.0 | Tier 1 pricing fix — correct rates for Lambda, SQS, API Gateway | ✅ shipped |
| v0.3.0 | `--usage-file` — monthly cost estimates for usage-based resources | ✅ shipped |
| v0.3.0 | Table polish — CDK hash stripping, sort by price, colored total | ✅ shipped |
| v0.4.0 | Secrets Manager and EKS handlers | ✅ shipped |
| v0.4.0 | EU region pricing fix — broken since v0.1.0 | ✅ shipped |
| v0.4.0 | Region coverage expanded from 13 to 38 regions | ✅ shipped |
| v0.4.0 | `--usage-file` JSON support | ✅ shipped |
| v0.5.0 | GitHub Action — `suneelsristi/stackprice-action` for PR comments | planned |
| v0.5.0 | CloudFront handler | planned |
| v0.5.0 | NAT Gateway handler | planned |
| v1.0.0 | Native CloudFormation template support (outside CDK) | planned |
| v1.0.0 | VS Code extension with inline cost annotations | planned |

---

## Contributing

Contributions are welcome.

**Branch workflow:**
- `main` — stable, protected
- `feature/xxx` — new features
- `bugfix/xxx` — bug fixes
- `chore/xxx` — tooling and config

For significant changes, open an issue first to discuss the approach.

---

## License

[MIT](LICENSE) — free for personal and commercial use.

---

Built with [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3),
[commander.js](https://github.com/tj/commander.js),
[cli-table3](https://github.com/cli-table/cli-table3), and
[chalk](https://github.com/chalk/chalk).
Implementation written with Claude Code.
