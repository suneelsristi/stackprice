import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  BreakdownResult,
  PricedStackResult,
  ResourceResult,
  UsageBasedResult,
  BreakdownSummary,
} from '../../../src/output/types.js';
import type { DiffResult } from '../../../src/output/diff-types.js';
import { computeDiff, formatDiffTable, formatDiffJson, formatDiffSummary } from '../../../src/output/diff.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeResource(overrides: Partial<ResourceResult> = {}): ResourceResult {
  return {
    logicalId: 'MyEc2',
    type: 'AWS::EC2::Instance',
    monthlyCost: 70.08,
    currency: 'USD',
    basis: 'Hrs',
    ...overrides,
  };
}

function makeUsageResource(overrides: Partial<UsageBasedResult> = {}): UsageBasedResult {
  return {
    logicalId: 'MyLambda',
    type: 'AWS::Lambda::Function',
    unitPrice: 0.0000002,
    unit: 'Requests',
    currency: 'USD',
    note: 'Usage-based — provide estimate via --usage-file',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<BreakdownSummary> = {}): BreakdownSummary {
  return {
    totalStacks: 1,
    totalResources: 1,
    pricedResources: 1,
    usageBasedResources: 0,
    conditionalResources: 0,
    unsupportedResources: 0,
    executionTimeMs: 100,
    ...overrides,
  };
}

function makeStack(overrides: Partial<PricedStackResult> = {}): PricedStackResult {
  return {
    stackId: 'MyStack',
    region: 'us-east-1',
    regionSource: 'template',
    resources: [makeResource()],
    usageBasedResources: [],
    conditionalResources: [],
    unsupportedTypes: [],
    stackMonthlyCost: 70.08,
    ...overrides,
  };
}

function makeBreakdown(overrides: Partial<BreakdownResult> = {}): BreakdownResult {
  return {
    schemaVersion: '1.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    stackpriceVersion: '0.1.0',
    stacks: [makeStack()],
    totalMonthlyCost: 70.08,
    currency: 'USD',
    summary: makeSummary(),
    ...overrides,
  };
}

// ─── computeDiff ──────────────────────────────────────────────────────────────

describe('computeDiff', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-04-17T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets schemaVersion, beforeFile, afterFile, and timestamp', () => {
    const before = makeBreakdown();
    const after = makeBreakdown();
    const result = computeDiff(before, after, 'before.json', 'after.json');

    expect(result.schemaVersion).toBe('1.0');
    expect(result.beforeFile).toBe('before.json');
    expect(result.afterFile).toBe('after.json');
    expect(result.timestamp).toBe('2026-04-17T12:00:00.000Z');
  });

  describe('resource classification', () => {
    it('classifies resource in after only as added', () => {
      const before = makeBreakdown({ stacks: [makeStack({ resources: [] })], totalMonthlyCost: 0 });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource({ logicalId: 'NewEc2', monthlyCost: 70.08 })] })],
        totalMonthlyCost: 70.08,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'NewEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('added');
      expect(found!.beforeCost).toBeNull();
      expect(found!.afterCost).toBe(70.08);
      expect(found!.delta).toBe(70.08);
      expect(found!.deltaPercent).toBeNull();
    });

    it('classifies resource in before only as removed', () => {
      const before = makeBreakdown();
      const after = makeBreakdown({ stacks: [makeStack({ resources: [] })], totalMonthlyCost: 0 });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'MyEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('removed');
      expect(found!.beforeCost).toBe(70.08);
      expect(found!.afterCost).toBeNull();
      expect(found!.delta).toBe(-70.08);
      expect(found!.deltaPercent).toBeCloseTo(-100);
    });

    it('classifies resource in both with different cost as changed', () => {
      const before = makeBreakdown();
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource({ monthlyCost: 100.00 })], stackMonthlyCost: 100.00 })],
        totalMonthlyCost: 100.00,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'MyEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('changed');
      expect(found!.beforeCost).toBe(70.08);
      expect(found!.afterCost).toBe(100.00);
      expect(found!.delta).toBeCloseTo(29.92);
      expect(found!.deltaPercent).toBeCloseTo((29.92 / 70.08) * 100);
    });

    it('classifies resource in both with same cost as unchanged', () => {
      const before = makeBreakdown();
      const after = makeBreakdown();

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'MyEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('unchanged');
      expect(found!.delta).toBe(0);
    });

    it('sets deltaPercent to null when beforeCost is 0 (changed resource)', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource({ monthlyCost: 0 })], stackMonthlyCost: 0 })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource({ monthlyCost: 50.00 })], stackMonthlyCost: 50.00 })],
        totalMonthlyCost: 50.00,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'MyEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('changed');
      expect(found!.deltaPercent).toBeNull();
    });

    it('sets deltaPercent to null for removed resource when beforeCost is 0', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource({ monthlyCost: 0 })], stackMonthlyCost: 0 })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({ stacks: [makeStack({ resources: [] })], totalMonthlyCost: 0 });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.resources.find((r) => r.logicalId === 'MyEc2');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('removed');
      expect(found!.deltaPercent).toBeNull();
    });

    it('matches resources by stackId + logicalId (same logicalId, different stacks)', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ stackId: 'StackA' })],
        totalMonthlyCost: 70.08,
      });
      const after = makeBreakdown({
        stacks: [makeStack({ stackId: 'StackB' })],
        totalMonthlyCost: 70.08,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');

      // Same logicalId but different stack — should be one removed and one added
      const removed = result.resources.find((r) => r.kind === 'removed');
      const added = result.resources.find((r) => r.kind === 'added');
      expect(removed).toBeDefined();
      expect(added).toBeDefined();
    });
  });

  describe('usage-based resources', () => {
    it('classifies usage-based resource in after only as added', () => {
      const before = makeBreakdown({ stacks: [makeStack({ resources: [], usageBasedResources: [] })], totalMonthlyCost: 0 });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource()] })],
        totalMonthlyCost: 0,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.usageBasedResources.find((r) => r.logicalId === 'MyLambda');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('added');
      expect(found!.beforeUnitPrice).toBeNull();
      expect(found!.afterUnitPrice).toBe(0.0000002);
    });

    it('classifies usage-based resource in before only as removed', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource()] })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({ stacks: [makeStack({ resources: [], usageBasedResources: [] })], totalMonthlyCost: 0 });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.usageBasedResources.find((r) => r.logicalId === 'MyLambda');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('removed');
      expect(found!.beforeUnitPrice).toBe(0.0000002);
      expect(found!.afterUnitPrice).toBeNull();
    });

    it('classifies usage-based resource with different unitPrice as changed', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource({ unitPrice: 0.0000001 })] })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource({ unitPrice: 0.0000002 })] })],
        totalMonthlyCost: 0,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.usageBasedResources.find((r) => r.logicalId === 'MyLambda');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('changed');
      expect(found!.beforeUnitPrice).toBe(0.0000001);
      expect(found!.afterUnitPrice).toBe(0.0000002);
    });

    it('classifies usage-based resource with same unitPrice as unchanged', () => {
      const before = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource()] })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [makeUsageResource()] })],
        totalMonthlyCost: 0,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      const found = result.usageBasedResources.find((r) => r.logicalId === 'MyLambda');

      expect(found).toBeDefined();
      expect(found!.kind).toBe('unchanged');
    });
  });

  describe('empty before or after', () => {
    it('all resources added when before is empty', () => {
      const emptyBreakdown = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [] })],
        totalMonthlyCost: 0,
      });
      const after = makeBreakdown({
        stacks: [makeStack({ resources: [makeResource(), makeResource({ logicalId: 'MyRds', type: 'AWS::RDS::DBInstance', monthlyCost: 102.57 })] })],
        totalMonthlyCost: 172.65,
      });

      const result = computeDiff(emptyBreakdown, after, 'a.json', 'b.json');
      expect(result.resources.every((r) => r.kind === 'added')).toBe(true);
    });

    it('all resources removed when after is empty', () => {
      const emptyBreakdown = makeBreakdown({
        stacks: [makeStack({ resources: [], usageBasedResources: [] })],
        totalMonthlyCost: 0,
      });

      const result = computeDiff(makeBreakdown(), emptyBreakdown, 'a.json', 'b.json');
      expect(result.resources.every((r) => r.kind === 'removed')).toBe(true);
    });

    it('no resources when both before and after are empty', () => {
      const empty = makeBreakdown({ stacks: [makeStack({ resources: [] })], totalMonthlyCost: 0 });
      const result = computeDiff(empty, empty, 'a.json', 'b.json');
      expect(result.resources).toHaveLength(0);
    });
  });

  describe('summary', () => {
    it('counts added, removed, changed, unchanged correctly', () => {
      const before = makeBreakdown({
        stacks: [makeStack({
          resources: [
            makeResource({ logicalId: 'Removed', monthlyCost: 50 }),
            makeResource({ logicalId: 'Changed', monthlyCost: 50 }),
            makeResource({ logicalId: 'Unchanged', monthlyCost: 50 }),
          ],
          stackMonthlyCost: 150,
        })],
        totalMonthlyCost: 150,
      });
      const after = makeBreakdown({
        stacks: [makeStack({
          resources: [
            makeResource({ logicalId: 'Added', monthlyCost: 100 }),
            makeResource({ logicalId: 'Changed', monthlyCost: 80 }),
            makeResource({ logicalId: 'Unchanged', monthlyCost: 50 }),
          ],
          stackMonthlyCost: 230,
        })],
        totalMonthlyCost: 230,
      });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      expect(result.summary.added).toBe(1);
      expect(result.summary.removed).toBe(1);
      expect(result.summary.changed).toBe(1);
      expect(result.summary.unchanged).toBe(1);
    });

    it('computes beforeTotal, afterTotal, and delta from BreakdownResult totals', () => {
      const before = makeBreakdown({ totalMonthlyCost: 82.41 });
      const after = makeBreakdown({ totalMonthlyCost: 210.16 });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      expect(result.summary.beforeTotal).toBe(82.41);
      expect(result.summary.afterTotal).toBe(210.16);
      expect(result.summary.delta).toBeCloseTo(127.75);
    });

    it('sets deltaPercent to null when beforeTotal is 0', () => {
      const before = makeBreakdown({ stacks: [makeStack({ resources: [] })], totalMonthlyCost: 0 });
      const after = makeBreakdown();

      const result = computeDiff(before, after, 'a.json', 'b.json');
      expect(result.summary.deltaPercent).toBeNull();
    });

    it('computes deltaPercent correctly when beforeTotal is non-zero', () => {
      const before = makeBreakdown({ totalMonthlyCost: 100 });
      const after = makeBreakdown({ totalMonthlyCost: 155 });

      const result = computeDiff(before, after, 'a.json', 'b.json');
      expect(result.summary.deltaPercent).toBeCloseTo(55);
    });
  });
});

// ─── formatDiffTable ──────────────────────────────────────────────────────────

function makeDiffResult(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    schemaVersion: '1.0',
    timestamp: '2026-04-17T12:00:00.000Z',
    beforeFile: 'before.json',
    afterFile: 'after.json',
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
    ...overrides,
  };
}

describe('formatDiffTable', () => {
  describe('header', () => {
    it('includes comparing line with before and after filenames', () => {
      const diff = makeDiffResult({ beforeFile: 'v1.json', afterFile: 'v2.json' });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Comparing: v1.json → v2.json');
    });
  });

  describe('table columns', () => {
    it('includes column headers: Resource ID, Stack, Type, Before, After, Delta', () => {
      const diff = makeDiffResult();
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Resource ID');
      expect(result).toContain('Stack');
      expect(result).toContain('Type');
      expect(result).toContain('Before');
      expect(result).toContain('After');
      expect(result).toContain('Delta');
    });

    it('shows added resource with dash for Before and formatted afterCost', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'NewEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
          kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
        }],
        summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('NewEc2');
      expect(result).toContain('$70.08');
    });

    it('shows removed resource with dash for After', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'OldEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
          kind: 'removed', beforeCost: 70.08, afterCost: null, delta: -70.08, deltaPercent: -100,
        }],
        summary: { added: 0, removed: 1, changed: 0, unchanged: 0, beforeTotal: 70.08, afterTotal: 0, delta: -70.08, deltaPercent: -100 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('OldEc2');
      expect(result).toContain('-$70.08');
    });

    it('shows changed resource with before and after costs and delta', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'MyEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
          kind: 'changed', beforeCost: 70.08, afterCost: 100.00, delta: 29.92, deltaPercent: 42.7,
        }],
        summary: { added: 0, removed: 0, changed: 1, unchanged: 0, beforeTotal: 70.08, afterTotal: 100.00, delta: 29.92, deltaPercent: 42.7 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('$70.08');
      expect(result).toContain('$100.00');
      expect(result).toContain('+$29.92');
    });

    it('does not show unchanged resources in the main table', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'StableEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
          kind: 'unchanged', beforeCost: 70.08, afterCost: 70.08, delta: 0, deltaPercent: 0,
        }],
        summary: { added: 0, removed: 0, changed: 0, unchanged: 1, beforeTotal: 70.08, afterTotal: 70.08, delta: 0, deltaPercent: 0 },
      });
      const result = formatDiffTable(diff, true);
      // StableEc2 should not appear in the table rows (only in unchanged summary)
      const tableSection = result.split('Unchanged')[0];
      expect(tableSection).not.toContain('StableEc2');
    });
  });

  describe('sort order', () => {
    it('sorts: removed first, then changed, then added', () => {
      const diff = makeDiffResult({
        resources: [
          { logicalId: 'AddedRes', stackId: 'S', type: 'AWS::EC2::Instance', kind: 'added', beforeCost: null, afterCost: 10, delta: 10, deltaPercent: null },
          { logicalId: 'ChangedRes', stackId: 'S', type: 'AWS::EC2::Instance', kind: 'changed', beforeCost: 20, afterCost: 30, delta: 10, deltaPercent: 50 },
          { logicalId: 'RemovedRes', stackId: 'S', type: 'AWS::EC2::Instance', kind: 'removed', beforeCost: 40, afterCost: null, delta: -40, deltaPercent: -100 },
        ],
        summary: { added: 1, removed: 1, changed: 1, unchanged: 0, beforeTotal: 60, afterTotal: 40, delta: -20, deltaPercent: -33.3 },
      });
      const result = formatDiffTable(diff, true);
      const removedPos = result.indexOf('RemovedRes');
      const changedPos = result.indexOf('ChangedRes');
      const addedPos = result.indexOf('AddedRes');
      expect(removedPos).toBeLessThan(changedPos);
      expect(changedPos).toBeLessThan(addedPos);
    });
  });

  describe('footer row', () => {
    it('includes Total label and summary costs', () => {
      const diff = makeDiffResult({
        summary: { added: 0, removed: 0, changed: 0, unchanged: 0, beforeTotal: 82.41, afterTotal: 210.16, delta: 127.75, deltaPercent: 155 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Total');
      expect(result).toContain('$82.41');
      expect(result).toContain('$210.16');
      expect(result).toContain('+$127.75');
    });

    it('formats negative delta correctly in footer', () => {
      const diff = makeDiffResult({
        summary: { added: 0, removed: 1, changed: 0, unchanged: 0, beforeTotal: 100, afterTotal: 0, delta: -100, deltaPercent: -100 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('-$100.00');
    });
  });

  describe('unchanged summary line', () => {
    it('shows unchanged summary line when there are unchanged resources', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'SessionTable', stackId: 'MyStack', type: 'AWS::DynamoDB::Table',
          kind: 'unchanged', beforeCost: 25, afterCost: 25, delta: 0, deltaPercent: 0,
        }],
        summary: { added: 0, removed: 0, changed: 0, unchanged: 1, beforeTotal: 25, afterTotal: 25, delta: 0, deltaPercent: 0 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Unchanged (1):');
      expect(result).toContain('DynamoDB SessionTable');
    });

    it('omits unchanged summary line when no unchanged resources', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'AddedEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
          kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
        }],
        summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
      });
      const result = formatDiffTable(diff, true);
      expect(result).not.toContain('Unchanged (');
    });

    it('shows multiple unchanged resources comma-separated', () => {
      const diff = makeDiffResult({
        resources: [
          { logicalId: 'SessionTable', stackId: 'S', type: 'AWS::DynamoDB::Table', kind: 'unchanged', beforeCost: 25, afterCost: 25, delta: 0, deltaPercent: 0 },
          { logicalId: 'DataBucket', stackId: 'S', type: 'AWS::S3::Bucket', kind: 'unchanged', beforeCost: 0.05, afterCost: 0.05, delta: 0, deltaPercent: 0 },
        ],
        summary: { added: 0, removed: 0, changed: 0, unchanged: 2, beforeTotal: 25.05, afterTotal: 25.05, delta: 0, deltaPercent: 0 },
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Unchanged (2):');
      expect(result).toContain('DynamoDB SessionTable');
      expect(result).toContain('S3 DataBucket');
    });
  });

  describe('usage-based section', () => {
    it('shows usage-based section when there are usage-based diffs', () => {
      const diff = makeDiffResult({
        usageBasedResources: [{
          logicalId: 'ApiHandler', stackId: 'MyStack', type: 'AWS::Lambda::Function',
          kind: 'unchanged', beforeUnitPrice: 0.000015, afterUnitPrice: 0.000015,
        }],
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('Usage-based changes:');
      expect(result).toContain('ApiHandler');
      expect(result).toContain('$0.000015');
      expect(result).toContain('(unchanged)');
    });

    it('omits usage-based section when there are no usage-based diffs', () => {
      const diff = makeDiffResult();
      const result = formatDiffTable(diff, true);
      expect(result).not.toContain('Usage-based changes:');
    });

    it('shows added usage-based resource with dash for before price', () => {
      const diff = makeDiffResult({
        usageBasedResources: [{
          logicalId: 'NewLambda', stackId: 'S', type: 'AWS::Lambda::Function',
          kind: 'added', beforeUnitPrice: null, afterUnitPrice: 0.0000002,
        }],
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('NewLambda: - → $0.0000002 (added)');
    });

    it('shows removed usage-based resource with dash for after price', () => {
      const diff = makeDiffResult({
        usageBasedResources: [{
          logicalId: 'OldLambda', stackId: 'S', type: 'AWS::Lambda::Function',
          kind: 'removed', beforeUnitPrice: 0.0000002, afterUnitPrice: null,
        }],
      });
      const result = formatDiffTable(diff, true);
      expect(result).toContain('OldLambda: $0.0000002 → - (removed)');
    });
  });

  describe('noColor', () => {
    it('noColor=true produces no ANSI escape codes', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'MyEc2', stackId: 'S', type: 'AWS::EC2::Instance',
          kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
        }],
        summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
      });
      const result = formatDiffTable(diff, true);
      expect(result).not.toMatch(/\x1b\[/);
    });

    it('noColor=false produces ANSI escape codes', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'MyEc2', stackId: 'S', type: 'AWS::EC2::Instance',
          kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
        }],
        summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
      });
      const result = formatDiffTable(diff, false);
      expect(result).toMatch(/\x1b\[/);
    });

    it('noColor=false uses green for added rows', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'AddedEc2', stackId: 'S', type: 'AWS::EC2::Instance',
          kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
        }],
        summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
      });
      const result = formatDiffTable(diff, false);
      // Green ANSI code: \x1b[32m
      expect(result).toContain('\x1b[32m');
    });

    it('noColor=false uses red for removed rows', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'RemovedEc2', stackId: 'S', type: 'AWS::EC2::Instance',
          kind: 'removed', beforeCost: 70.08, afterCost: null, delta: -70.08, deltaPercent: -100,
        }],
        summary: { added: 0, removed: 1, changed: 0, unchanged: 0, beforeTotal: 70.08, afterTotal: 0, delta: -70.08, deltaPercent: -100 },
      });
      const result = formatDiffTable(diff, false);
      // Red ANSI code: \x1b[31m
      expect(result).toContain('\x1b[31m');
    });

    it('noColor=false uses yellow for changed rows', () => {
      const diff = makeDiffResult({
        resources: [{
          logicalId: 'ChangedEc2', stackId: 'S', type: 'AWS::EC2::Instance',
          kind: 'changed', beforeCost: 70.08, afterCost: 100.00, delta: 29.92, deltaPercent: 42.7,
        }],
        summary: { added: 0, removed: 0, changed: 1, unchanged: 0, beforeTotal: 70.08, afterTotal: 100.00, delta: 29.92, deltaPercent: 42.7 },
      });
      const result = formatDiffTable(diff, false);
      // Yellow ANSI code: \x1b[33m
      expect(result).toContain('\x1b[33m');
    });
  });
});

// ─── formatDiffJson ───────────────────────────────────────────────────────────

describe('formatDiffJson', () => {
  it('returns valid JSON', () => {
    const diff = makeDiffResult();
    const result = formatDiffJson(diff);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('JSON output matches DiffResult shape', () => {
    const diff = makeDiffResult({
      beforeFile: 'before.json',
      afterFile: 'after.json',
      resources: [{
        logicalId: 'MyEc2', stackId: 'MyStack', type: 'AWS::EC2::Instance',
        kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null,
      }],
      summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
    });
    const parsed = JSON.parse(formatDiffJson(diff)) as DiffResult;
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.beforeFile).toBe('before.json');
    expect(parsed.afterFile).toBe('after.json');
    expect(parsed.resources).toHaveLength(1);
    expect(parsed.resources[0]!.kind).toBe('added');
    expect(parsed.summary.added).toBe(1);
  });

  it('is pretty-printed with 2-space indentation', () => {
    const diff = makeDiffResult();
    const result = formatDiffJson(diff);
    expect(result).toContain('  ');
    expect(result.split('\n').length).toBeGreaterThan(1);
  });
});

// ─── formatDiffSummary ────────────────────────────────────────────────────────

describe('formatDiffSummary', () => {
  it('formats positive delta with percent and all counts', () => {
    const diff = makeDiffResult({
      resources: [
        { logicalId: 'A', stackId: 'S', type: 'T', kind: 'added', beforeCost: null, afterCost: 70.08, delta: 70.08, deltaPercent: null },
        { logicalId: 'B', stackId: 'S', type: 'T', kind: 'removed', beforeCost: 12.41, afterCost: null, delta: -12.41, deltaPercent: -100 },
        { logicalId: 'C', stackId: 'S', type: 'T', kind: 'changed', beforeCost: 50, afterCost: 120.08, delta: 70.08, deltaPercent: 140.16 },
        { logicalId: 'D', stackId: 'S', type: 'T', kind: 'unchanged', beforeCost: 25, afterCost: 25, delta: 0, deltaPercent: 0 },
        { logicalId: 'E', stackId: 'S', type: 'T', kind: 'unchanged', beforeCost: 25, afterCost: 25, delta: 0, deltaPercent: 0 },
        { logicalId: 'F', stackId: 'S', type: 'T', kind: 'unchanged', beforeCost: 25, afterCost: 25, delta: 0, deltaPercent: 0 },
      ],
      summary: { added: 1, removed: 1, changed: 1, unchanged: 3, beforeTotal: 82.41, afterTotal: 210.16, delta: 127.75, deltaPercent: 155 },
    });
    const result = formatDiffSummary(diff);
    expect(result).toBe('+$127.75/month (+155%) · 1 added · 1 removed · 1 changed · 3 unchanged');
  });

  it('formats negative delta correctly', () => {
    const diff = makeDiffResult({
      summary: { added: 0, removed: 1, changed: 0, unchanged: 0, beforeTotal: 100, afterTotal: 0, delta: -100, deltaPercent: -100 },
    });
    const result = formatDiffSummary(diff);
    expect(result).toContain('-$100.00/month');
    expect(result).toContain('(-100%)');
  });

  it('omits percent when deltaPercent is null', () => {
    const diff = makeDiffResult({
      summary: { added: 1, removed: 0, changed: 0, unchanged: 0, beforeTotal: 0, afterTotal: 70.08, delta: 70.08, deltaPercent: null },
    });
    const result = formatDiffSummary(diff);
    expect(result).toContain('+$70.08/month');
    expect(result).not.toContain('%');
  });

  it('formats zero delta as +$0.00/month', () => {
    const diff = makeDiffResult({
      summary: { added: 0, removed: 0, changed: 0, unchanged: 2, beforeTotal: 50, afterTotal: 50, delta: 0, deltaPercent: 0 },
    });
    const result = formatDiffSummary(diff);
    expect(result).toContain('+$0.00/month');
    expect(result).toContain('(+0%)');
  });

  it('uses correct counts in the summary line', () => {
    const diff = makeDiffResult({
      summary: { added: 3, removed: 2, changed: 1, unchanged: 5, beforeTotal: 100, afterTotal: 200, delta: 100, deltaPercent: 100 },
    });
    const result = formatDiffSummary(diff);
    expect(result).toContain('3 added');
    expect(result).toContain('2 removed');
    expect(result).toContain('1 changed');
    expect(result).toContain('5 unchanged');
  });
});
