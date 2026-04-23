import * as fs from 'fs';
import * as path from 'path';

import { Command } from 'commander';
import chalk from 'chalk';

import {
  discoverUsageResources,
  generateYaml,
  generateJson,
  writeGeneratedFile,
  TYPE_MAP,
} from '../generate/usage-file-generator.js';

import { checkCredentials } from '../pricing/credentials.js';
import { readAssembly } from '../assembly/reader.js';
import { parseStacks } from '../template/parser.js';
import { priceStacks } from '../pricing/engine.js';
import { parseUsageFile } from '../pricing/usage-calculator.js';
import type { UsageFile } from '../pricing/types.js';
import { formatTable } from '../output/table.js';
import { formatJson } from '../output/json.js';
import { formatSummary } from '../output/summary.js';
import { computeDiff, formatDiffTable, formatDiffJson, formatDiffSummary } from '../output/diff.js';
import type { BreakdownResult } from '../output/types.js';
import { ResourceHandlerRegistry } from '../registry/index.js';
import { ec2Handler } from '../registry/handlers/ec2.js';
import { rdsHandler } from '../registry/handlers/rds.js';
import { lambdaHandler } from '../registry/handlers/lambda.js';
import { s3Handler } from '../registry/handlers/s3.js';
import { dynamodbHandler } from '../registry/handlers/dynamodb.js';
import { ecsHandler } from '../registry/handlers/ecs.js';
import { sqsHandler } from '../registry/handlers/sqs.js';
import { snsHandler } from '../registry/handlers/sns.js';
import { elasticacheHandler } from '../registry/handlers/elasticache.js';
import { apigatewayHandler } from '../registry/handlers/apigateway.js';
import { secretsManagerHandler } from '../registry/handlers/secretsmanager.js';
import { eksHandler } from '../registry/handlers/eks.js';
import { natGatewayHandler } from '../registry/handlers/natgateway.js';
import { EXIT_CODES, StackPriceError } from '../errors/index.js';
import packageJson from '../../package.json';

// ─── Commander option shapes ──────────────────────────────────────────────────

interface DiffOptions {
  format: string;
  color: boolean;   // false when --no-color is passed
  outFile?: string;
}

interface BreakdownOptions {
  dir: string;
  template?: string;
  stack?: string;
  region?: string;
  output: string;
  outFile?: string;
  color: boolean;   // false when --no-color is passed
  verbose: boolean;
  cache: boolean;   // false when --no-cache is passed
  usageFile?: string;
}

// ─── Type guards ─────────────────────────────────────────────────────────────

function isBreakdownResult(value: unknown): value is BreakdownResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    (value as Record<string, unknown>).schemaVersion === '1.0' &&
    'stacks' in value &&
    Array.isArray((value as Record<string, unknown>).stacks)
  );
}

// ─── Registry factory ─────────────────────────────────────────────────────────

function createRegistry(): ResourceHandlerRegistry {
  const registry = new ResourceHandlerRegistry();
  registry.register(ec2Handler);
  registry.register(rdsHandler);
  registry.register(lambdaHandler);
  registry.register(s3Handler);
  registry.register(dynamodbHandler);
  registry.register(ecsHandler);
  registry.register(sqsHandler);
  registry.register(snsHandler);
  registry.register(elasticacheHandler);
  registry.register(apigatewayHandler);
  registry.register(secretsManagerHandler);
  registry.register(eksHandler);
  registry.register(natGatewayHandler);
  return registry;
}

// ─── Program factory ──────────────────────────────────────────────────────────

export function createProgram(): Command {
  const program = new Command();

  program
    .name('stackprice')
    .version(packageJson.version, '-v, --version', 'Print version and exit');

  // ── breakdown ──────────────────────────────────────────────────────────────

  program
    .command('breakdown')
    .description('Estimate monthly AWS costs from a CDK cloud assembly')
    .option('--dir <path>', 'Path to cdk.out directory', 'cdk.out')
    .option('--template <path>', 'Single template file to price (optional)')
    .option('--stack <name>', 'Filter to a single stack by name (optional)')
    .option('--region <region>', 'Explicit AWS region override (optional)')
    .option('--output <format>', 'Output format: table | json | summary', 'table')
    .option('--out-file <path>', 'Write output to file instead of stdout (optional)')
    .option('--no-color', 'Disable colour output')
    .option('--verbose', 'Show region resolution details', false)
    .option('--no-cache', 'Skip cache, always fetch fresh prices')
    .option('--usage-file <path>', 'Path to YAML usage estimates file (optional)')
    .action(async (options: BreakdownOptions) => {
      const startTime = Date.now();

      // ── 1. Validate --dir (Security Rule 1 — path validation) ─────────────
      const resolvedDir = path.resolve(options.dir);
      if (!fs.existsSync(resolvedDir)) {
        process.stderr.write(`Error: Directory not found: ${options.dir}\n`);
        process.exit(2);
        return;
      }

      // ── Validate --output ──────────────────────────────────────────────────
      const validFormats = ['table', 'json', 'summary'];
      if (!validFormats.includes(options.output)) {
        process.stderr.write(
          `Error: Invalid output format "${options.output}". Must be one of: table, json, summary\n`,
        );
        process.exit(2);
        return;
      }

      const noColor = !options.color;
      const noCache = !options.cache;
      const output = options.output as 'table' | 'json' | 'summary';

      chalk.level = noColor ? 0 : 3;

      try {
        // ── 2. Check credentials ─────────────────────────────────────────────
        await checkCredentials();

        // ── 3. Read assembly ──────────────────────────────────────────────────
        const assembly = readAssembly(resolvedDir);

        // ── 4. Parse stacks (resolveRegion called per-stack inside, ADR-008) ──
        let stacks = parseStacks(assembly, resolvedDir, options.region);

        if (options.verbose) {
          for (const stack of stacks) {
            process.stderr.write(
              `[verbose] Stack "${stack.stackId}": region=${stack.region} (source: ${stack.regionSource})\n`,
            );
          }
        }

        // ── 5. Filter by --stack ─────────────────────────────────────────────
        if (options.stack !== undefined) {
          stacks = stacks.filter((s) => s.stackId === options.stack);
          if (stacks.length === 0) {
            process.stderr.write(`Error: No stack found matching name: ${options.stack}\n`);
            process.exit(1);
            return;
          }
        }

        // ── 6. Price stacks ───────────────────────────────────────────────────
        let usageFileData: UsageFile | undefined;
        if (options.usageFile !== undefined) {
          usageFileData = parseUsageFile(options.usageFile);
        }

        const registry = createRegistry();
        const pricedStacks = await priceStacks(stacks, registry, noCache, usageFileData);

        // ── 7. Format output ──────────────────────────────────────────────────
        let formatted: string;
        if (output === 'json') {
          formatted = formatJson(pricedStacks, startTime);
        } else if (output === 'summary') {
          formatted = formatSummary(pricedStacks, startTime);
        } else {
          formatted = formatTable(pricedStacks, noColor);
        }

        // ── 8. Write output ───────────────────────────────────────────────────
        if (options.outFile !== undefined) {
          const resolvedOutFile = path.resolve(options.outFile);
          fs.writeFileSync(resolvedOutFile, formatted + '\n', 'utf-8');
        } else {
          process.stdout.write(formatted + '\n');
        }
      } catch (err: unknown) {
        if (err instanceof StackPriceError) {
          process.stderr.write(chalk.red(`✗ ${err.message}\n`));
          if (options.verbose && err.stack) {
            process.stderr.write(`${err.stack}\n`);
          }
          process.exit(err.exitCode);
        } else {
          if (options.verbose) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(chalk.red(`An unexpected error occurred: ${msg}\n`));
            if (err instanceof Error && err.stack) {
              process.stderr.write(`${err.stack}\n`);
            }
          } else {
            process.stderr.write(chalk.red(`An unexpected error occurred.\n`));
            process.stderr.write(`Use --verbose for details.\n`);
          }
          process.exit(2);
        }
      }
    });

  // ── diff ───────────────────────────────────────────────────────────────────

  program
    .command('diff')
    .description('Compare costs between two stackprice JSON output files')
    .argument('<before>', 'Path to the first breakdown JSON file')
    .argument('<after>', 'Path to the second breakdown JSON file')
    .option('--format <format>', 'Output format: table | json | summary', 'table')
    .option('--no-color', 'Disable colour output')
    .option('--out-file <path>', 'Write output to file instead of stdout (optional)')
    .action((beforeArg: string, afterArg: string, options: DiffOptions) => {
      const noColor = !options.color;

      chalk.level = noColor ? 0 : 3;

      try {
        // ── 1. Validate paths (Security Rule 1 — path validation) ────────────
        const resolvedBefore = path.resolve(beforeArg);
        if (!fs.existsSync(resolvedBefore)) {
          throw new StackPriceError(
            `File not found: ${beforeArg}. Generate one with: stackprice breakdown --output json --out-file <path>`,
            2,
          );
        }

        const resolvedAfter = path.resolve(afterArg);
        if (!fs.existsSync(resolvedAfter)) {
          throw new StackPriceError(
            `File not found: ${afterArg}. Generate one with: stackprice breakdown --output json --out-file <path>`,
            2,
          );
        }

        // ── 2. Read and parse both files ──────────────────────────────────────
        let beforeData: unknown;
        try {
          beforeData = JSON.parse(fs.readFileSync(resolvedBefore, 'utf-8') as string);
        } catch {
          throw new StackPriceError(`${beforeArg} is not a valid JSON file`, 2);
        }

        let afterData: unknown;
        try {
          afterData = JSON.parse(fs.readFileSync(resolvedAfter, 'utf-8') as string);
        } catch {
          throw new StackPriceError(`${afterArg} is not a valid JSON file`, 2);
        }

        // ── 3. Type-guard: verify schema ──────────────────────────────────────
        if (!isBreakdownResult(beforeData)) {
          throw new StackPriceError(
            `${beforeArg} is not a valid stackprice output file. Generate one with: stackprice breakdown --output json --out-file <path>`,
            2,
          );
        }

        if (!isBreakdownResult(afterData)) {
          throw new StackPriceError(
            `${afterArg} is not a valid stackprice output file. Generate one with: stackprice breakdown --output json --out-file <path>`,
            2,
          );
        }

        // ── 4. Compute diff ───────────────────────────────────────────────────
        const diff = computeDiff(beforeData, afterData, resolvedBefore, resolvedAfter);

        // ── 5. Format output ──────────────────────────────────────────────────
        const format = options.format as 'table' | 'json' | 'summary';
        let formatted: string;
        if (format === 'json') {
          formatted = formatDiffJson(diff);
        } else if (format === 'summary') {
          formatted = formatDiffSummary(diff);
        } else {
          formatted = formatDiffTable(diff, noColor);
        }

        // ── 6. Write output ───────────────────────────────────────────────────
        if (options.outFile !== undefined) {
          const resolvedOutFile = path.resolve(options.outFile);
          fs.writeFileSync(resolvedOutFile, formatted + '\n', 'utf-8');
        } else {
          process.stdout.write(formatted + '\n');
        }
      } catch (err: unknown) {
        if (err instanceof StackPriceError) {
          process.stderr.write(chalk.red(`✗ ${err.message}\n`));
          process.exit(err.exitCode);
        } else {
          process.stderr.write(chalk.red(`An unexpected error occurred.\n`));
          process.exit(2);
        }
      }
    });

  // ── generate ───────────────────────────────────────────────────────────────

  const generateCmd = program
    .command('generate')
    .description('Generate files from a CDK cloud assembly');

  generateCmd
    .command('usage-file')
    .description('Generate a pre-populated usage estimates file for usage-based resources')
    .option('--dir <path>', 'Path to CDK cloud assembly directory', 'cdk.out')
    .option('--stack <name>', 'Filter to a specific stack name (optional)')
    .option('--format <format>', 'Output format: yaml or json', 'yaml')
    .option('--out-file <path>', 'Output file path (default depends on --format)')
    .option('--force', 'Overwrite existing output file', false)
    .option('--types <list>', 'Comma-separated resource types to include (e.g. Lambda,S3)')
    .option('--no-color', 'Disable colour output')
    .action((options: {
      dir: string;
      stack?: string;
      format: string;
      outFile?: string;
      force: boolean;
      types?: string;
      color: boolean;
    }) => {
      chalk.level = options.color ? 3 : 0;

      try {
        // ── Validate --format ──────────────────────────────────────────────────
        if (options.format !== 'yaml' && options.format !== 'json') {
          throw new StackPriceError(
            `Invalid format "${options.format}". Must be yaml or json.`,
            EXIT_CODES.FAILURE,
          );
        }

        const format = options.format as 'yaml' | 'json';

        // ── Resolve default outFile ────────────────────────────────────────────
        const outFile = options.outFile ?? (format === 'json' ? 'stackprice-usage.json' : 'stackprice-usage.yml');

        // ── Validate --types ───────────────────────────────────────────────────
        const validShortNames = Object.keys(TYPE_MAP);
        let typeFilter: string[] = [];

        if (options.types !== undefined) {
          typeFilter = options.types.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
          for (const t of typeFilter) {
            if (!Object.prototype.hasOwnProperty.call(TYPE_MAP, t)) {
              throw new StackPriceError(
                `Unknown resource type '${t}'. Valid types: ${validShortNames.join(', ')}`,
                EXIT_CODES.FAILURE,
              );
            }
          }
        }

        // ── Discover resources ─────────────────────────────────────────────────
        const resources = discoverUsageResources(options.dir, options.stack, typeFilter.length > 0 ? typeFilter : undefined);

        if (resources.length === 0) {
          process.stderr.write(`Warning: No usage-based resources found in ${options.dir}.\n`);
        }

        // ── Generate content ───────────────────────────────────────────────────
        const generateOptions = {
          dir: options.dir,
          stack: options.stack,
          format,
          outFile,
          force: options.force,
          types: typeFilter,
        };

        const content = format === 'json'
          ? generateJson(resources, generateOptions)
          : generateYaml(resources, generateOptions);

        // ── Write file ─────────────────────────────────────────────────────────
        writeGeneratedFile(content, outFile, options.force);

        // ── Print confirmation ─────────────────────────────────────────────────
        const typeCounts = new Map<string, number>();
        for (const r of resources) {
          typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
        }

        process.stdout.write(`Generated ${outFile} with ${resources.length} usage-based resources:\n`);
        for (const [cfnType, count] of typeCounts) {
          process.stdout.write(`  ${count} × ${cfnType}\n`);
        }
        process.stdout.write(`\nEdit the TODO values, then run:\n`);
        process.stdout.write(`  stackprice breakdown --dir ${options.dir} --usage-file ${outFile}\n`);
        process.stdout.write(`\nNote: Generated without AWS credentials.\n`);

      } catch (err: unknown) {
        if (err instanceof StackPriceError) {
          process.stderr.write(chalk.red(`✗ ${err.message}\n`));
          process.exit(err.exitCode);
        } else {
          process.stderr.write(chalk.red(`An unexpected error occurred.\n`));
          process.exit(2);
        }
      }
    });

  return program;
}
