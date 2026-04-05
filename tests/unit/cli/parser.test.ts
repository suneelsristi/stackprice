import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ParsedStack } from '../../../src/template/types.js';
import type { PricedStack } from '../../../src/pricing/types.js';

// ─── fs mocks ─────────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockWriteFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]): unknown => mockExistsSync(...args),
    writeFileSync: (...args: unknown[]): unknown => mockWriteFileSync(...args),
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

function makePricedStack(stackId: string): PricedStack {
  return {
    stackId,
    region: 'us-east-1',
    regionSource: 'template',
    pricedResources: [],
    usageBasedResources: [],
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
    mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
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

  it('unknown error caught → generic stderr message + exit 2', async () => {
    mockCheckCredentials.mockRejectedValue(new Error('unexpected failure'));

    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'breakdown', '--dir', '/fake/cdk.out']);

    expect(mockStderr).toHaveBeenCalledWith(
      'An unexpected error occurred. Use --verbose for details.\n',
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
});

// ─── diff command ─────────────────────────────────────────────────────────────

describe('createProgram — diff command', () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockStdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: number) => undefined as never);
    mockStdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints coming-soon message and exits 0', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'stackprice', 'diff']);

    expect(mockStdout).toHaveBeenCalledWith('stackprice diff is coming in v0.2.0\n');
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
