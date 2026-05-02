# Contributing to stackprice

Thank you for your interest in contributing to stackprice. This document explains how to get started, what we expect from contributions, and how the project is structured.

---

## Before You Start

For significant changes — new handlers, new commands, architectural changes — please **open an issue first** to discuss the approach. This avoids wasted effort if the direction does not fit the project.

For small fixes (typos, documentation, minor bug fixes), feel free to open a PR directly.

---

## Development Setup

**Prerequisites:**
- Node.js >= 20.x
- AWS credentials configured (`aws configure` or `aws login` for IAM Identity Center)

**Setup:**

```bash
git clone https://github.com/suneelsristi/stackprice
cd stackprice
npm install
npm run build
npm test
```

All tests must pass before submitting a PR.

---

## Project Structure

```
src/
  assembly/       — CDK cloud assembly reader
  cli/            — CLI parser and command definitions
  errors/         — StackPriceError and exit codes
  generate/       — generate usage-file command
  output/         — table, JSON, summary, diff formatters
  pricing/        — engine, client, cache, region, usage calculator
  registry/       — handler registry and all resource handlers
  template/       — CloudFormation template parser
  utils/          — shared utilities
tests/
  unit/           — unit tests (mirrors src/ structure)
```

---

## Adding a New Resource Handler

This is the most common contribution. Each handler prices one CloudFormation resource type.

**Steps:**

1. Verify the pricing API values before writing any code:
```bash
aws pricing describe-services --service-code {serviceCode} --region us-east-1
aws pricing get-attribute-values --service-code {serviceCode} \
  --attribute-name productFamily --region us-east-1
aws pricing get-products --service-code {serviceCode} --region us-east-1 \
  --filters "Type=TERM_MATCH,Field=productFamily,Value=..."
```

2. Create `src/registry/handlers/{resourcename}.ts`
3. Create `tests/unit/registry/handlers/{resourcename}.test.ts`
4. Register the handler in `src/cli/parser.ts`
5. Add usage keys to `src/pricing/types.ts` and `src/pricing/usage-calculator.ts` if usage-based
6. Add to `src/generate/usage-file-generator.ts` if usage-based

**Handler interface:**

```typescript
export const myHandler: ResourceHandler = {
  resourceType: 'AWS::MyService::MyResource',
  pricingType: 'fixed', // or 'usage-based' or 'mixed'
  extractPricingAttributes(resource) { ... },
  buildPricingQuery(attrs, region) { ... },
  calculateMonthlyCost(result, attrs) { ... },
};
```

Read any existing handler in `src/registry/handlers/` as a reference. The `natgateway.ts` handler is a good example of a `mixed` pricingType handler.

**Coverage requirement:** 100% for new handler files.

---

## Code Standards

- **TypeScript strict mode** — no `any`, use `unknown` and narrow
- **No classes** except `ResourceHandlerRegistry` and `StackPriceError`
- **Named exports only** — no default exports
- **No barrel files**
- **async/await only** — no `.then()` chains
- **All errors** → stderr. **All output** → stdout. Always.
- **No `console.log()`** in `src/` — use `process.stderr.write()` for diagnostics
- **Import paths** must use `.js` extension:
  ```typescript
  import { StackPriceError } from '../errors/index.js';
  ```

---

## Testing Requirements

- Every `src/` file must have a corresponding `tests/unit/` test file
- AWS Pricing API must always be mocked — never call the real API in tests
- Never read real `~/.aws/config` in tests — use `vi.stubEnv()`
- Never write real files in tests — mock the filesystem

**Run tests:**
```bash
npm test                 # run all tests
npm test -- --coverage   # with coverage report
npm run build            # verify TypeScript compiles
npm run lint             # verify no lint errors
```

All four must be clean before submitting a PR.

---

## Pricing API Verification

**Any pricing constant used in a handler must be verified against the live AWS Pricing API before merging.** Do not use values from memory, documentation, or the AWS pricing page alone — always verify with `aws pricing get-products`.

If a value is hardcoded rather than fetched from the API (e.g. storage rates), add a comment block with:
- The value and what it represents
- The verification command to re-check it
- The date it was last verified
- A link to the relevant AWS pricing page

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add AWS::ElasticSearch::Domain handler
fix: correct eu-west-1 prefix for Kinesis Firehose
chore: bump @aws-sdk/client-pricing to 3.1037.0
docs: update README with new handler examples
test: add coverage for mixed pricingType edge cases
refactor: extract region prefix logic to shared utility
```

---

## Branch Naming

```
feature/handler-name      — new resource handler
feature/command-name      — new CLI command
bugfix/issue-description  — bug fix
chore/description         — tooling, dependencies, config
docs/description          — documentation only
refactor/description      — refactoring without behaviour change
```

---

## Pull Request Checklist

Before opening a PR, verify:

- [ ] `npm test` passes with zero failures
- [ ] `npm run build` exits clean
- [ ] `npm run lint` exits clean
- [ ] New handler files have 100% coverage
- [ ] Pricing API values verified with live `aws pricing get-products` queries
- [ ] Hardcoded pricing values include verification comment with date
- [ ] Handler registered in `src/cli/parser.ts`
- [ ] Usage-based handlers added to `usage-calculator.ts` and `usage-file-generator.ts`
- [ ] No `console.log()` in `src/`
- [ ] No real AWS API calls in tests
- [ ] Commit messages follow Conventional Commits format

---

## Questions

Open an issue with the `question` label or start a discussion on the repository.
