#!/usr/bin/env node

import { createProgram } from './cli/parser.js';
import { StackPriceError } from './errors/index.js';

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    if (err instanceof StackPriceError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(err.exitCode);
    } else {
      process.stderr.write('An unexpected error occurred.\n');
      process.exit(2);
    }
  });
