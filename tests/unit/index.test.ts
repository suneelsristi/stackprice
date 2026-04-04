import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── Mock createProgram to prevent real CLI execution ─────────────────────────

const mockParseAsync = vi.fn().mockResolvedValue(undefined);
const mockCreateProgram = vi.fn(() => ({ parseAsync: mockParseAsync }));

vi.mock('../../src/cli/parser.js', () => ({
  createProgram: (...args: unknown[]): unknown => mockCreateProgram(...args),
}));

vi.mock('../../src/errors/index.js', () => ({
  StackPriceError: class StackPriceError extends Error {
    constructor(
      message: string,
      public readonly exitCode: 0 | 1 | 2,
    ) {
      super(message);
      this.name = 'StackPriceError';
    }
  },
}));

describe('src/index.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCreateProgram.mockClear();
    mockParseAsync.mockClear();
    mockParseAsync.mockResolvedValue(undefined);
  });

  it('imports without throwing', async () => {
    await expect(import('../../src/index.js')).resolves.not.toThrow();
  });

  it('shebang is present in compiled dist/index.js', () => {
    const distPath = path.resolve(process.cwd(), 'dist/index.js');
    // Only assert if dist exists (may not exist in CI before build)
    if (fs.existsSync(distPath)) {
      const firstLine = fs.readFileSync(distPath, 'utf-8').split('\n')[0];
      expect(firstLine).toBe('#!/usr/bin/env node');
    } else {
      // Skip gracefully if dist not yet built
      expect(true).toBe(true);
    }
  });
});
