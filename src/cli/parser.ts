import * as fs from 'fs';
import * as path from 'path';

import { Command } from 'commander';

import { checkCredentials } from '../pricing/credentials.js';
import { readAssembly } from '../assembly/reader.js';
import { parseStacks } from '../template/parser.js';
import { priceStacks } from '../pricing/engine.js';
import { formatTable } from '../output/table.js';
import { formatJson } from '../output/json.js';
import { formatSummary } from '../output/summary.js';
import { ResourceHandlerRegistry } from '../registry/index.js';
import { ec2Handler } from '../registry/handlers/ec2.js';
import { rdsHandler } from '../registry/handlers/rds.js';
import { lambdaHandler } from '../registry/handlers/lambda.js';
import { s3Handler } from '../registry/handlers/s3.js';
import { dynamodbHandler } from '../registry/handlers/dynamodb.js';
import { ecsHandler } from '../registry/handlers/ecs.js';
import { sqsHandler } from '../registry/handlers/sqs.js';
import { snsHandler } from '../registry/handlers/sns.js';
import { StackPriceError } from '../errors/index.js';
import packageJson from '../../package.json';

// ─── Commander option shape (before mapping to CliOptions) ───────────────────

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
        const registry = createRegistry();
        const pricedStacks = await priceStacks(stacks, registry, noCache);

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
          process.stderr.write(`Error: ${err.message}\n`);
          process.exit(err.exitCode);
        } else {
          process.stderr.write(`An unexpected error occurred. Use --verbose for details.\n`);
          process.exit(2);
        }
      }
    });

  // ── diff (coming soon) ─────────────────────────────────────────────────────

  program
    .command('diff')
    .description('Compare costs between two CDK assemblies (coming in v0.2.0)')
    .action(() => {
      process.stdout.write('stackprice diff is coming in v0.2.0\n');
      process.exit(0);
    });

  return program;
}
