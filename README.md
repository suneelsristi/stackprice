# stackprice

**AWS CDK infrastructure pricing estimation CLI — know what it costs before you deploy.**

`stackprice` is an open source CLI tool that reads your synthesized CDK output and
returns an itemized monthly cost estimate — per resource, per stack, and in total —
before a single dollar is spent.

```bash
cdk synth
stackprice breakdown --dir ./cdk.out
```

```
  Stack: ApiStack                                          Region: us-east-1
  ┌──────────────────────────────┬─────────────────────────┬─────────────────┐
  │ Resource ID                  │ Type                    │ Monthly Cost    │
  ├──────────────────────────────┼─────────────────────────┼─────────────────┤
  │ WebServer                    │ AWS::EC2::Instance       │ $124.10         │
  │ Database                     │ AWS::RDS::DBInstance     │ $48.55          │
  │ ProcessingQueue              │ AWS::SQS::Queue          │ Usage-based     │
  │ ImageBucket                  │ AWS::S3::Bucket          │ Usage-based     │
  ├──────────────────────────────┼─────────────────────────┼─────────────────┤
  │ Stack Subtotal                                         │ $172.65 + usage │
  └──────────────────────────────┴─────────────────────────┴─────────────────┘

  TOTAL ESTIMATED MONTHLY COST: $172.65 + usage-based resources
  ✓ 1 stack · 4 resources priced · 2 usage-based · completed in 2.3s
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

# Pre-built binaries (no Node.js required)
# Download from: github.com/suneelsristi/stackprice/releases
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
| `--template` | string | — | Path to a single CloudFormation JSON template |
| `--stack` | string | all | Name of specific stack to analyze |
| `--region` | string | from template | AWS region for pricing lookup |
| `--output` | enum | `table` | Output format: `table`, `json`, `summary` |
| `--out-file` | string | — | Write output to file instead of stdout |
| `--no-cache` | bool | false | Skip cache, always fetch fresh pricing |
| `--no-color` | bool | false | Disable color output |
| `--verbose` | bool | false | Show pricing API queries and resolution details |

### `stackprice diff` *(coming in v0.2.0)*

Compare two breakdown JSON outputs and show the cost delta per resource and in total.

---

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

Unsupported resource types are skipped with a warning and listed at the end of output.
They never cause the tool to fail.

---

## CloudFormation Conditions

If your CDK app uses CloudFormation Conditions to toggle resources on or off,
`stackprice` handles them safely:

- Conditioned resources are **excluded from the cost total**
- They are shown in a separate section with their unit cost and condition name
- Use `--conditions` flag in v0.2.0 to evaluate specific condition values

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

| Version | Feature |
|---|---|
| v0.2.0 | `stackprice diff` — cost delta between two estimates |
| v0.2.0 | GitHub Actions integration — PR cost comments |
| v0.2.0 | `--conditions` flag — evaluate CloudFormation Conditions |
| v0.2.0 | Expanded resource coverage: ElastiCache, EKS, CloudFront, API Gateway |
| v0.3.0 | `--usage-file` — provide usage estimates for Lambda, S3, data transfer |
| v0.3.0 | `--offline` mode — no credentials required |
| v0.4.0 | Savings Plans / Reserved Instance comparison |
| v1.0.0 | Native CloudFormation template support (outside CDK) |
| v1.0.0 | VS Code extension with inline cost annotations |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

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
