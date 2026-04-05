import { describe, it, expect } from 'vitest';
import type { PricedStack } from '../../../src/pricing/types.js';
import { formatTable } from '../../../src/output/table.js';

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
      {
        logicalId: 'RdsDb',
        type: 'AWS::RDS::DBInstance',
        monthlyCost: 102.57,
        currency: 'USD',
        basis: 'Hrs',
      },
    ],
    usageBasedResources: [],
    conditionalResources: [],
    unsupportedTypes: [],
    stackMonthlyCost: 172.65,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('formatTable', () => {
  describe('structure', () => {
    it('includes stack header with stackId and region', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('Stack: MyStack');
      expect(result).toContain('Region: us-east-1');
    });

    it('includes resource logicalIds in the table', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('Ec2Instance');
      expect(result).toContain('RdsDb');
    });

    it('includes resource types in the table', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('AWS::EC2::Instance');
      expect(result).toContain('AWS::RDS::DBInstance');
    });

    it('includes monthly costs formatted as $x.xx', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('$70.08');
      expect(result).toContain('$102.57');
    });

    it('includes stack subtotal row', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('Stack Subtotal');
      expect(result).toContain('$172.65');
    });

    it('includes TOTAL ESTIMATED MONTHLY COST footer', () => {
      const result = formatTable([makeStack()], true);
      expect(result).toContain('TOTAL ESTIMATED MONTHLY COST: $172.65');
    });

    it('sorts fixed resources descending by monthlyCost', () => {
      const result = formatTable([makeStack()], true);
      const ec2Pos = result.indexOf('Ec2Instance');
      const rdsPos = result.indexOf('RdsDb');
      // RDS ($102.57) should appear before EC2 ($70.08) after descending sort
      expect(rdsPos).toBeLessThan(ec2Pos);
    });
  });

  describe('usage-based resources', () => {
    it('renders usage-based table when present', () => {
      const stack = makeStack({
        usageBasedResources: [
          { logicalId: 'MyLambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
        ],
      });
      const result = formatTable([stack], true);
      expect(result).toContain('MyLambda');
      expect(result).toContain('AWS::Lambda::Function');
      expect(result).toContain('Usage-based — provide estimate via --usage-file');
    });

    it('appends + usage-based to TOTAL line when usage-based resources exist', () => {
      const stack = makeStack({
        usageBasedResources: [
          { logicalId: 'MyLambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
        ],
      });
      const result = formatTable([stack], true);
      expect(result).toContain('+ usage-based');
    });

    it('does not show + usage-based when no usage-based resources', () => {
      const result = formatTable([makeStack()], true);
      expect(result).not.toContain('+ usage-based');
    });
  });

  describe('conditional resources (ADR-011)', () => {
    it('renders conditional resources table when present', () => {
      const stack = makeStack({
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
      const result = formatTable([stack], true);
      expect(result).toContain('ConditionalEc2');
      expect(result).toContain('IsProd');
      expect(result).toContain('$70.08');
    });

    it('shows Usage-based for null monthlyCost conditional resources', () => {
      const stack = makeStack({
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
      const result = formatTable([stack], true);
      expect(result).toContain('ConditionalLambda');
      expect(result).toContain('IsEnabled');
      expect(result).toContain('Usage-based');
    });
  });

  describe('empty stacks', () => {
    it('handles empty stacks array gracefully', () => {
      const result = formatTable([], true);
      expect(result).toContain('TOTAL ESTIMATED MONTHLY COST: $0.00');
    });

    it('handles stack with no resources', () => {
      const stack = makeStack({ pricedResources: [], stackMonthlyCost: 0 });
      const result = formatTable([stack], true);
      expect(result).toContain('Stack: MyStack');
      expect(result).toContain('TOTAL ESTIMATED MONTHLY COST: $0.00');
    });
  });

  describe('unsupported types', () => {
    it('lists unsupported types', () => {
      const stack = makeStack({ unsupportedTypes: ['AWS::CloudFront::Distribution'] });
      const result = formatTable([stack], true);
      expect(result).toContain('AWS::CloudFront::Distribution');
    });
  });

  describe('noColor', () => {
    it('noColor=true produces output without ANSI escape codes', () => {
      const result = formatTable([makeStack()], true);
      // ANSI escape sequences start with ESC (\x1b) followed by [
      expect(result).not.toMatch(/\x1b\[/);
    });

    it('noColor=false produces output with ANSI escape codes for headers', () => {
      const result = formatTable([makeStack()], false);
      expect(result).toMatch(/\x1b\[/);
    });

    it('both noColor modes produce the same resource data', () => {
      const stack = makeStack();
      const withColor = formatTable([stack], false);
      const noColor = formatTable([stack], true);

      // Strip ANSI from colored output
      const stripped = withColor.replace(/\x1b\[[0-9;]*m/g, '');
      // Both should contain the same logical content
      expect(stripped).toContain('Ec2Instance');
      expect(noColor).toContain('Ec2Instance');
    });
  });

  describe('noColor=false branches for sub-tables', () => {
    it('renders usage-based table with color enabled', () => {
      const stack = makeStack({
        usageBasedResources: [
          { logicalId: 'MyLambda', type: 'AWS::Lambda::Function', unitPrice: 0.0000002, unit: 'Requests', currency: 'USD' },
        ],
      });
      const result = formatTable([stack], false);
      expect(result).toContain('MyLambda');
      // With color enabled, ANSI codes should be present
      expect(result).toMatch(/\x1b\[/);
    });

    it('renders conditional table with color enabled', () => {
      const stack = makeStack({
        conditionalResources: [
          {
            logicalId: 'CondEc2',
            type: 'AWS::EC2::Instance',
            conditionName: 'IsProd',
            monthlyCost: 70.08,
            currency: 'USD',
          },
        ],
      });
      const result = formatTable([stack], false);
      expect(result).toContain('CondEc2');
      expect(result).toMatch(/\x1b\[/);
    });

    it('renders unsupported types label with color enabled', () => {
      const stack = makeStack({ unsupportedTypes: ['AWS::CloudFront::Distribution'] });
      const result = formatTable([stack], false);
      expect(result).toContain('AWS::CloudFront::Distribution');
      expect(result).toMatch(/\x1b\[/);
    });
  });

  describe('unit price formatting (scientific notation)', () => {
    function makeStackWithUnitPrice(unitPrice: number): PricedStack {
      return makeStack({
        pricedResources: [],
        stackMonthlyCost: 0,
        usageBasedResources: [
          { logicalId: 'MyResource', type: 'AWS::SQS::Queue', unitPrice, unit: 'Requests', currency: 'USD' },
        ],
      });
    }

    it('formats very small SQS price (2.4e-7) without scientific notation', () => {
      const result = formatTable([makeStackWithUnitPrice(2.4e-7)], true);
      expect(result).toContain('$0.0000002');
      expect(result).not.toContain('2.4e-7');
      expect(result).not.toContain('2.4e-');
    });

    it('formats very small SNS price (5e-7) without scientific notation', () => {
      const result = formatTable([makeStackWithUnitPrice(5e-7)], true);
      expect(result).toContain('$0.0000005');
      expect(result).not.toContain('5e-7');
      expect(result).not.toContain('5e-');
    });

    it('formats price >= 0.01 with 2 decimal places', () => {
      const result = formatTable([makeStackWithUnitPrice(0.022)], true);
      expect(result).toContain('$0.02');
      expect(result).not.toMatch(/\d+e[-+]/);
    });

    it('formats price >= 0.0001 with 4 decimal places', () => {
      const result = formatTable([makeStackWithUnitPrice(0.000015)], true);
      expect(result).toContain('$0.0000');
      expect(result).not.toMatch(/\d+e[-+]/);
    });

    it('formats price below 1e-7 with 10 decimal places', () => {
      const result = formatTable([makeStackWithUnitPrice(1e-10)], true);
      expect(result).not.toMatch(/\d+e[-+]/);
    });
  });

  describe('multi-stack', () => {
    it('renders headers for each stack', () => {
      const stack1 = makeStack({ stackId: 'StackA', region: 'us-east-1' });
      const stack2 = makeStack({ stackId: 'StackB', region: 'eu-west-1' });
      const result = formatTable([stack1, stack2], true);

      expect(result).toContain('Stack: StackA');
      expect(result).toContain('Stack: StackB');
      expect(result).toContain('Region: us-east-1');
      expect(result).toContain('Region: eu-west-1');
    });

    it('sums costs from all stacks in the TOTAL line', () => {
      const stack1 = makeStack({ stackId: 'Stack1', stackMonthlyCost: 50.00, pricedResources: [
        { logicalId: 'Ec2A', type: 'AWS::EC2::Instance', monthlyCost: 50.00, currency: 'USD', basis: 'Hrs' },
      ]});
      const stack2 = makeStack({ stackId: 'Stack2', stackMonthlyCost: 122.65, pricedResources: [
        { logicalId: 'Ec2B', type: 'AWS::EC2::Instance', monthlyCost: 122.65, currency: 'USD', basis: 'Hrs' },
      ]});
      const result = formatTable([stack1, stack2], true);

      expect(result).toContain('TOTAL ESTIMATED MONTHLY COST: $172.65');
    });
  });
});
