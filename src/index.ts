#!/usr/bin/env node

import { createProgram } from './cli/parser.js';
import { StackPriceError } from './errors/index.js';
import chalk from 'chalk';

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    if (err instanceof StackPriceError) {
      process.stderr.write(chalk.red(`${err.message}\n`));
      process.exit(err.exitCode);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(chalk.red(`An unexpected error occurred: ${msg}\n`));
      process.exit(2);
    }
  });