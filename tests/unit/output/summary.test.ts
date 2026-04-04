import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PricedStack } from '../../../src/pricing/types.js';
import { formatSummary } from '../../../src/output/summary.js';

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

describe('formatSummary', () => {
  const FIXED_NOW = new Date('2025-06-01T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces expected format with priced resources', () => {
    const stacks = [makeStack()];
    const result = formatSummary(stacks, FIXED_NOW - 1200);

    expect(result).toBe('TOTAL: $70.08/month · 1 stack · 1 priced · 1.2s');
  });

  it('includes usage-based count when present', () => {
    const stack = makeStack({
      usageBasedResources: [
        { logicalId: 'Lambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
      ],
    });
    const result = formatSummary([stack], FIXED_NOW - 500);

    expect(result).toContain('+ usage-based');
    expect(result).toContain('1 usage-based');
  });

  it('shows N/A for cost when only usage-based resources present', () => {
    const stack = makeStack({
      pricedResources: [],
      stackMonthlyCost: 0,
      usageBasedResources: [
        { logicalId: 'Lambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
      ],
    });
    const result = formatSummary([stack], FIXED_NOW - 800);

    expect(result).toContain('TOTAL: N/A');
    expect(result).toContain('+ usage-based');
  });

  it('handles empty stacks array gracefully', () => {
    const result = formatSummary([], FIXED_NOW - 300);

    expect(result).toContain('TOTAL: $0.00/month');
    expect(result).toContain('0 stacks');
    expect(result).toContain('0 priced');
  });

  it('sums costs across multiple stacks', () => {
    const stack1 = makeStack({ stackId: 'Stack1', stackMonthlyCost: 50.00, pricedResources: [
      { logicalId: 'Ec2A', type: 'AWS::EC2::Instance', monthlyCost: 50.00, currency: 'USD', basis: 'Hrs' },
    ]});
    const stack2 = makeStack({ stackId: 'Stack2', stackMonthlyCost: 122.65, pricedResources: [
      { logicalId: 'Ec2B', type: 'AWS::EC2::Instance', monthlyCost: 122.65, currency: 'USD', basis: 'Hrs' },
    ]});
    const result = formatSummary([stack1, stack2], FIXED_NOW - 1200);

    expect(result).toContain('$172.65/month');
    expect(result).toContain('2 stacks');
    expect(result).toContain('2 priced');
  });

  it('uses plural for stacks when count > 1', () => {
    const stack1 = makeStack({ stackId: 'Stack1' });
    const stack2 = makeStack({ stackId: 'Stack2' });
    const result = formatSummary([stack1, stack2], FIXED_NOW);

    expect(result).toContain('2 stacks');
  });

  it('uses singular for stack when count is 1', () => {
    const result = formatSummary([makeStack()], FIXED_NOW);

    expect(result).toContain('1 stack ');
    expect(result).not.toContain('1 stacks');
  });

  it('formats elapsed time correctly', () => {
    const result = formatSummary([makeStack()], FIXED_NOW - 2500);

    expect(result).toContain('2.5s');
  });

  it('does not show usage-based segment when no usage-based resources', () => {
    const result = formatSummary([makeStack()], FIXED_NOW - 800);

    expect(result).not.toContain('usage-based');
  });
});
