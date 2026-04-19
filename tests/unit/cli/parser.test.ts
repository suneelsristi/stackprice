import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedStack } from '../../../src/template/types.js';
import type { PricedStack } from '../../../src/pricing/types.js';
import type { BreakdownResult } from '../../../src/output/types.js';
import type { DiffResult } from '../../../src/output/diff-types.js';

// ─── fs mocks ─────────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]): unknown => mockExistsSync(...args),
    writeFileSync: (...args: unknown[]): unknown => mockWriteFileSync(...args),
    readFileSync: (...args: unknown[]): unknown => mockReadFileSync(...args),
  };
});

// ─── Pipeline mocks ───────────────────────────────────────────────────────────

const mockCheckCredentials = vi.fn();

vi.mock('../../../src/pricing/credentials.js', () => ({
  checkCredentials: (...args: unknown[]): unknown => mockCheckCredentials(...args),
}));

const mockReadAssembly = vi.fn();

vi.mock('../../../src/assembly/reader.js', () => ({
  readAssembly: (...args: unknown[]): unknown => mockReadAssembly(...args),
}));

const mockParseStacks = vi.fn();

vi.mock('../../../src/template/parser.js', () => ({
  parseStacks: (...args: unknown[]): unknown => mockParseStacks(...args),
}));

const mockPriceStacks = vi.fn();

vi.mock('../../../src/pricing/engine.js', () => ({
  priceStacks: (...args: unknown[]): unknown => mockPriceStacks(...args),
}));

const mockParseUsageFile = vi.fn();

vi.mock('../../../src/pricing/usage-calculator.js', () => ({
  parseUsageFile: (...args: unknown[]): unknown => mockParseUsageFile(...args),
  calculateEstimatedCost: vi.fn(),
}));

const mockFormatTable = vi.fn();

vi.mock('../../../src/output/table.js', () => ({
  formatTable: (...args: unknown[]): unknown => mockFormatTable(...args),
}));

const mockFormatJson = vi.fn();

vi.mock('../../../src/output/json.js', () => ({
  formatJson: (...args: unknown[]): unknown => mockFormatJson(...args),
}));

const mockFormatSummary = vi.fn();

vi.mock('../../../src/output/summary.js', () => ({
  formatSummary: (...args: unknown[]): unknown => mockFormatSummary(...args),
}));

const mockComputeDiff = vi.fn();
const mockFormatDiffTable = vi.fn();
const mockFormatDiffJson = vi.fn();
const mockFormatDiffSummary = vi.fn();

vi.mock('../../../src/output/diff.js', () => ({
  computeDiff: (...args: unknown[]): unknown => mockComputeDiff(...args),
  formatDiffTable: (...args: unknown[]): unknown => mockFormatDiffTable(...args),
  formatDiffJson: (...args: unknown[]): unknown => mockFormatDiffJson(...args),
  formatDiffSummary: (...args: unknown[]): unknown => mockFormatDiffSummary(...args),
}));

import { createProgram } from '../../../src/cli/parser.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeAssembly = { version: '17.0.0', stacks: [] };

function makeParsedStack(stackId: string): ParsedStack {
  return {
    stackId,
    region: 'us-east-1',
    regionSource: 'template',
    resources: [],
    conditionalResources: [],
    unsupportedTypes: [],
  };
}

function makeBreakdownResult(): BreakdownResult {
  return {
    schemaVersion: '1.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    stackpriceVersion: '0.1.0',
    stacks: [],
    totalMonthlyCost: 0,
    currency: 'USD',
    summary: {
      totalStacks: 0,
      totalResources: 0,
      pricedResources: 0,
      usageBasedResources: 0,
      conditionalResources: 0,
      unsupportedResources: 0,
      executionTimeMs: 0,
    },
  };
}

function makeDiffResult(): DiffResult {
  return {
    schemaVersion: '1.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    beforeFile: '/fake/before.json',
    afterFile: '/fake/after.json',
    resources: [],
    usageBasedResources: [],
    summary: {
      added: 0,
      removed: 0,
      changed: 0,
      unchanged: 0,
      beforeTotal: 0,
      afterTotal: 0,
      delta: 0,
      deltaPercent: null,
    },
  };
}

function makePricedStack(stackId: string): PricedStack {
  return {
    stackId,
    region: 'us-east-1',
    regionSource: 'template',
    pricedResources: [],
    usageBasedResources: [],
    estimatedResources: [],
    conditionalResources: [],
    unsupportedTypes: [],
    stackMonthlyCost: 0,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createProgram — breakdown command', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockStdout: ReturnType<typeof vi.spyOn>;
  let mockStderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid --dir resolves the full pipeline and writes to stdout', async () => {
    const parsedStacks = [makeParsedStack('MyStack')];
    const pricedStacks = [makePricedStack('MyStack')];

    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue(parsedStacks);
    mockPriceStacks.mockResolvedValue(pricedStacks);
    mockFormatTable.mockReturnValue('table output');

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown', '--dir', '/fake/cdk.out']);

    expect(mockCheckCredentials).toHaveBeenCalledOnce();
    expect(mockReadAssembly).toHaveBeenCalledOnce();
    expect(mockParseStacks).toHaveBeenCalledOnce();
    expect(mockPriceStacks).toHaveBeenCalledOnce();
    expect(mockFormatTable).toHaveBeenCalledWith(pricedStacks, false);
    expect(mockStdout).toHaveBeenCalledWith('table output\n');
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('missing --dir defaults to cdk.out', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('output');

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown']);

    expect(mockReadAssembly).toHaveBeenCalledWith(expect.stringContaining('cdk.out'));
  });

  it('non-existent --dir → stderr message + exit 2, credentials not checked', async () => {
    mockExistsSync.mockReturnValue(false);

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown', '--dir', '/missing/dir']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Directory not found'));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockCheckCredentials).not.toHaveBeenCalled();
  });

  it('StackPriceError caught → stderr message + correct exit code', async () => {
    const { StackPriceError, EXIT_CODES } = await import('../../../src/errors/index.js');

    mockCheckCredentials.mockRejectedValue(
      new StackPriceError('No credentials found', EXIT_CODES.FAILURE),
    );

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown', '--dir', '/fake/cdk.out']);

    expect(mockStderr).toHaveBeenCalledWith('Error: No credentials found\n');
    expect(mockExit).toHaveBeenCalledWith(EXIT_CODES.FAILURE);
  });

  it('unknown error caught without --verbose → hint included in message', async () => {
    mockCheckCredentials.mockRejectedValue(new Error('unexpected failure'));

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown', '--dir', '/fake/cdk.out']);

    expect(mockStderr).toHaveBeenCalledWith(
      'An unexpected error occurred. Use --verbose for details.\n',
    );
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('unknown error caught with --verbose → no hint, stack trace printed', async () => {
    const err = new Error('unexpected failure');
    mockCheckCredentials.mockRejectedValue(err);

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--verbose',
    ]);

    expect(mockStderr).toHaveBeenCalledWith('An unexpected error occurred.\n');
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('Error: unexpected failure'));
    expect(mockStderr).not.toHaveBeenCalledWith(
      expect.stringContaining('Use --verbose'),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('--output json invokes formatJson and writes JSON to stdout', async () => {
    const pricedStacks = [makePricedStack('MyStack')];

    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue(pricedStacks);
    mockFormatJson.mockReturnValue('{"stacks":[]}');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--output', 'json',
    ]);

    expect(mockFormatJson).toHaveBeenCalledWith(pricedStacks, expect.any(Number));
    expect(mockFormatTable).not.toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith('{"stacks":[]}\n');
  });

  it('--output summary invokes formatSummary', async () => {
    const pricedStacks = [makePricedStack('MyStack')];

    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue(pricedStacks);
    mockFormatSummary.mockReturnValue('TOTAL: $0.00/month');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--output', 'summary',
    ]);

    expect(mockFormatSummary).toHaveBeenCalledWith(pricedStacks, expect.any(Number));
    expect(mockFormatTable).not.toHaveBeenCalled();
  });

  it('--out-file writes to file instead of stdout', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('table output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--out-file', '/tmp/output.txt',
    ]);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('output.txt'),
      'table output\n',
      'utf-8',
    );
    expect(mockStdout).not.toHaveBeenCalled();
  });

  it('--stack filters stacks and passes only matched stack to priceStacks', async () => {
    const parsedStacks = [makeParsedStack('StackA'), makeParsedStack('StackB')];

    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue(parsedStacks);
    mockPriceStacks.mockResolvedValue([makePricedStack('StackA')]);
    mockFormatTable.mockReturnValue('filtered output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--stack', 'StackA',
    ]);

    const [filteredArg] = mockPriceStacks.mock.calls[0] as [ParsedStack[], unknown, unknown];
    expect(filteredArg).toHaveLength(1);
    expect(filteredArg[0]?.stackId).toBe('StackA');
  });

  it('--stack with no match → stderr + exit 1', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('StackA')]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--stack', 'NonExistentStack',
    ]);

    expect(mockStderr).toHaveBeenCalledWith(
      expect.stringContaining('No stack found matching name'),
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('--no-color passes noColor=true to formatTable', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('plain output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--no-color',
    ]);

    expect(mockFormatTable).toHaveBeenCalledWith(expect.any(Array), true);
  });

  it('--no-cache passes noCache=true to priceStacks', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--no-cache',
    ]);

    const [, , noCacheArg] = mockPriceStacks.mock.calls[0] as [unknown, unknown, boolean];
    expect(noCacheArg).toBe(true);
  });

  it('--usage-file: parseUsageFile called with correct path and result passed to priceStacks', async () => {
    const usageData = { MyLambda: { requests_per_month: 5000000, avg_duration_ms: 200 } };
    mockParseUsageFile.mockReturnValue(usageData);

    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
      '--usage-file', '/fake/usage.yml',
    ]);

    expect(mockParseUsageFile).toHaveBeenCalledWith('/fake/usage.yml');
    const [, , , usageFileArg] = mockPriceStacks.mock.calls[0] as [unknown, unknown, unknown, unknown];
    expect(usageFileArg).toEqual(usageData);
  });

  it('--usage-file missing: parseUsageFile not called and undefined passed to priceStacks', async () => {
    mockCheckCredentials.mockResolvedValue(undefined);
    mockReadAssembly.mockReturnValue(fakeAssembly);
    mockParseStacks.mockReturnValue([makeParsedStack('MyStack')]);
    mockPriceStacks.mockResolvedValue([makePricedStack('MyStack')]);
    mockFormatTable.mockReturnValue('output');

    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'breakdown',
      '--dir', '/fake/cdk.out',
    ]);

    expect(mockParseUsageFile).not.toHaveBeenCalled();
    const [, , , usageFileArg] = mockPriceStacks.mock.calls[0] as [unknown, unknown, unknown, unknown];
    expect(usageFileArg).toBeUndefined();
  });
});

// ─── diff command ─────────────────────────────────────────────────────────────

describe('createProgram — diff command', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockStdout: ReturnType<typeof vi.spyOn>;
  let mockStderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(makeBreakdownResult()));
    mockComputeDiff.mockReturnValue(makeDiffResult());
    mockFormatDiffTable.mockReturnValue('diff table output');
    mockFormatDiffJson.mockReturnValue('{"diff":true}');
    mockFormatDiffSummary.mockReturnValue('+$0.00/month · 0 added · 0 removed');
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mockStderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid before + after files → calls computeDiff + formatDiffTable + writes to stdout', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockComputeDiff).toHaveBeenCalledOnce();
    expect(mockFormatDiffTable).toHaveBeenCalledOnce();
    expect(mockFormatDiffJson).not.toHaveBeenCalled();
    expect(mockFormatDiffSummary).not.toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith('diff table output\n');
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('before file not found → StackPriceError with path and hint', async () => {
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && !p.includes('before'),
    );

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('before.json'));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockComputeDiff).not.toHaveBeenCalled();
  });

  it('after file not found → StackPriceError with path and hint', async () => {
    mockExistsSync.mockImplementation((p: unknown) =>
      typeof p === 'string' && !p.includes('after'),
    );

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('File not found'));
    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('after.json'));
    expect(mockExit).toHaveBeenCalledWith(2);
    expect(mockComputeDiff).not.toHaveBeenCalled();
  });

  it('invalid JSON in before file → StackPriceError "not a valid JSON file"', async () => {
    mockReadFileSync.mockReturnValueOnce('not json at all');

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('not a valid JSON file'));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('invalid JSON in after file → StackPriceError "not a valid JSON file"', async () => {
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(makeBreakdownResult()))
      .mockReturnValueOnce('{bad json');

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(expect.stringContaining('not a valid JSON file'));
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('wrong schema (missing schemaVersion) in before file → StackPriceError', async () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ stacks: [] }));

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(
      expect.stringContaining('not a valid stackprice output file'),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('wrong schema in after file → StackPriceError', async () => {
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(makeBreakdownResult()))
      .mockReturnValueOnce(JSON.stringify({ stacks: [] }));

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith(
      expect.stringContaining('not a valid stackprice output file'),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it('--format json → formatDiffJson called, formatDiffTable not called', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'diff',
      '/fake/before.json', '/fake/after.json',
      '--format', 'json',
    ]);

    expect(mockFormatDiffJson).toHaveBeenCalledOnce();
    expect(mockFormatDiffTable).not.toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith('{"diff":true}\n');
  });

  it('--format summary → formatDiffSummary called, formatDiffTable not called', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'diff',
      '/fake/before.json', '/fake/after.json',
      '--format', 'summary',
    ]);

    expect(mockFormatDiffSummary).toHaveBeenCalledOnce();
    expect(mockFormatDiffTable).not.toHaveBeenCalled();
    expect(mockStdout).toHaveBeenCalledWith('+$0.00/month · 0 added · 0 removed\n');
  });

  it('--out-file writes to file instead of stdout', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'diff',
      '/fake/before.json', '/fake/after.json',
      '--out-file', '/tmp/diff-output.txt',
    ]);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('diff-output.txt'),
      'diff table output\n',
      'utf-8',
    );
    expect(mockStdout).not.toHaveBeenCalled();
  });

  it('does NOT call checkCredentials', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockCheckCredentials).not.toHaveBeenCalled();
  });

  it('--no-color passes noColor=true to formatDiffTable', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'stackprice', 'diff',
      '/fake/before.json', '/fake/after.json',
      '--no-color',
    ]);

    expect(mockFormatDiffTable).toHaveBeenCalledWith(expect.any(Object), true);
  });

  it('unknown error caught → generic message with no --verbose hint', async () => {
    mockComputeDiff.mockImplementation(() => { throw new Error('unexpected failure'); });

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff', '/fake/before.json', '/fake/after.json']);

    expect(mockStderr).toHaveBeenCalledWith('An unexpected error occurred.\n');
    expect(mockStderr).not.toHaveBeenCalledWith(
      expect.stringContaining('Use --verbose'),
    );
    expect(mockExit).toHaveBeenCalledWith(2);
  });
});
