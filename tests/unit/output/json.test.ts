import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PricedStack } from '../../../src/pricing/types.js';
import type { BreakdownResult } from '../../../src/output/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeStack(overrides: Partial<PricedStack> = {}): PricedStack {
  return {
    stackId: 'MyStack',
    region: 'us-east-1',
    regionSource: 'template',
    pricedResources: [
      {
        logicalId: 'Ec2Instance',
        type: 'AWS::EC2::Instance',
        monthlyCost: 70.08,
        currency: 'USD',
        basis: 'Hrs',
      },
    ],
    usageBasedResources: [],
    conditionalResources: [],
    unsupportedTypes: [],
    stackMonthlyCost: 70.08,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('formatJson', () => {
  const FIXED_NOW = new Date('2025-06-01T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns valid JSON that parses back to BreakdownResult shape', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stacks = [makeStack()];
    const output = formatJson(stacks, FIXED_NOW - 1200);

    const parsed = JSON.parse(output) as BreakdownResult;
    expect(parsed.schemaVersion).toBe('1.0');
    expect(parsed.currency).toBe('USD');
    expect(parsed.timestamp).toBe('2025-06-01T12:00:00.000Z');
    expect(typeof parsed.stackpriceVersion).toBe('string');
    expect(parsed.stackpriceVersion.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.stacks)).toBe(true);
    expect(typeof parsed.totalMonthlyCost).toBe('number');
    expect(parsed.summary).toBeDefined();
  });

  it('maps a priced resource to ResourceResult shape', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const output = formatJson([makeStack()], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    const resource = parsed.stacks[0]!.resources[0]!;
    expect(resource.logicalId).toBe('Ec2Instance');
    expect(resource.type).toBe('AWS::EC2::Instance');
    expect(resource.monthlyCost).toBe(70.08);
    expect(resource.currency).toBe('USD');
    expect(resource.basis).toBe('Hrs');
  });

  it('computes totalMonthlyCost as sum of stackMonthlyCosts', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack1 = makeStack({ stackId: 'Stack1', stackMonthlyCost: 50 });
    const stack2 = makeStack({ stackId: 'Stack2', stackMonthlyCost: 122.65 });
    const output = formatJson([stack1, stack2], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    expect(parsed.totalMonthlyCost).toBeCloseTo(172.65);
  });

  it('computes executionTimeMs from Date.now() - startTime', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const startTime = FIXED_NOW - 1500;
    const output = formatJson([makeStack()], startTime);
    const parsed = JSON.parse(output) as BreakdownResult;

    expect(parsed.summary.executionTimeMs).toBe(1500);
  });

  it('handles empty stacks array gracefully', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const output = formatJson([], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    expect(parsed.stacks).toHaveLength(0);
    expect(parsed.totalMonthlyCost).toBe(0);
    expect(parsed.summary.totalStacks).toBe(0);
    expect(parsed.summary.totalResources).toBe(0);
  });

  it('maps usage-based resources to UsageBasedResult shape', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack = makeStack({
      pricedResources: [],
      stackMonthlyCost: 0,
      usageBasedResources: [
        {
          logicalId: 'MyLambda',
          type: 'AWS::Lambda::Function',
          unitPrice: 0.0000002,
          unit: 'Requests',
          currency: 'USD',
        },
      ],
    });

    const output = formatJson([stack], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    const ubr = parsed.stacks[0]!.usageBasedResources[0]!;
    expect(ubr.logicalId).toBe('MyLambda');
    expect(ubr.type).toBe('AWS::Lambda::Function');
    expect(ubr.unitPrice).toBe(0.0000002);
    expect(ubr.unit).toBe('Requests');
    expect(ubr.currency).toBe('USD');
    expect(ubr.note).toBe('Usage-based — provide estimate via --usage-file');
  });

  it('maps conditional resources to ConditionalResult shape (ADR-011)', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack = makeStack({
      pricedResources: [],
      stackMonthlyCost: 0,
      conditionalResources: [
        {
          logicalId: 'ConditionalEc2',
          type: 'AWS::EC2::Instance',
          conditionName: 'IsProd',
          monthlyCost: 70.08,
          currency: 'USD',
        },
      ],
    });

    const output = formatJson([stack], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    const cr = parsed.stacks[0]!.conditionalResources[0]!;
    expect(cr.logicalId).toBe('ConditionalEc2');
    expect(cr.conditionName).toBe('IsProd');
    expect(cr.monthlyCost).toBe(70.08);
    expect(cr.note).toBe('Excluded from total — gated by CloudFormation Condition');
  });

  it('maps conditional usage-based resource with null monthlyCost', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack = makeStack({
      pricedResources: [],
      stackMonthlyCost: 0,
      conditionalResources: [
        {
          logicalId: 'ConditionalLambda',
          type: 'AWS::Lambda::Function',
          conditionName: 'IsEnabled',
          monthlyCost: null,
          currency: 'USD',
        },
      ],
    });

    const output = formatJson([stack], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;

    expect(parsed.stacks[0]!.conditionalResources[0]!.monthlyCost).toBeNull();
  });

  it('sets summary counts correctly for mixed stack', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack = makeStack({
      pricedResources: [
        { logicalId: 'Ec2', type: 'AWS::EC2::Instance', monthlyCost: 70, currency: 'USD', basis: 'Hrs' },
      ],
      usageBasedResources: [
        { logicalId: 'Lambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
      ],
      conditionalResources: [
        { logicalId: 'CondEc2', type: 'AWS::EC2::Instance', conditionName: 'IsProd', monthlyCost: 70, currency: 'USD' },
      ],
      unsupportedTypes: ['AWS::CloudFront::Distribution'],
      stackMonthlyCost: 70,
    });

    const output = formatJson([stack], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;
    const summary = parsed.summary;

    expect(summary.totalStacks).toBe(1);
    expect(summary.pricedResources).toBe(1);
    expect(summary.usageBasedResources).toBe(1);
    expect(summary.conditionalResources).toBe(1);
    expect(summary.unsupportedResources).toBe(1);
    expect(summary.totalResources).toBe(3); // priced + usage-based + conditional
  });

  it('passes through stackId, region, regionSource, and unsupportedTypes', async () => {
    const { formatJson } = await import('../../../src/output/json.js');
    const stack = makeStack({
      stackId: 'ProdStack',
      region: 'eu-west-1',
      regionSource: 'flag',
      unsupportedTypes: ['AWS::CloudFront::Distribution'],
    });

    const output = formatJson([stack], FIXED_NOW);
    const parsed = JSON.parse(output) as BreakdownResult;
    const sr = parsed.stacks[0]!;

    expect(sr.stackId).toBe('ProdStack');
    expect(sr.region).toBe('eu-west-1');
    expect(sr.regionSource).toBe('flag');
    expect(sr.unsupportedTypes).toContain('AWS::CloudFront::Distribution');
  });
});
