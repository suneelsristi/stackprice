import type { PricedStack } from '../pricing/types.js';
import type {
  BreakdownResult,
  PricedStackResult,
  ResourceResult,
  UsageBasedResult,
  EstimatedResult,
  ConditionalResult,
  BreakdownSummary,
} from './types.js';
import packageJson from '../../package.json';

function buildSummary(stacks: PricedStack[], executionTimeMs: number): BreakdownSummary {
  let totalResources = 0;
  let pricedResources = 0;
  let usageBasedResources = 0;
  let conditionalResources = 0;
  let unsupportedResources = 0;

  for (const stack of stacks) {
    pricedResources += stack.pricedResources.length;
    usageBasedResources += stack.usageBasedResources.length;
    conditionalResources += stack.conditionalResources.length;
    unsupportedResources += stack.unsupportedTypes.length;
    totalResources +=
      stack.pricedResources.length +
      stack.usageBasedResources.length +
      stack.estimatedResources.length +
      stack.conditionalResources.length;
  }

  return {
    totalStacks: stacks.length,
    totalResources,
    pricedResources,
    usageBasedResources,
    conditionalResources,
    unsupportedResources,
    executionTimeMs,
  };
}

function toStackResult(stack: PricedStack): PricedStackResult {
  const resources: ResourceResult[] = stack.pricedResources.map((r) => ({
    logicalId: r.logicalId,
    type: r.type,
    monthlyCost: r.monthlyCost,
    currency: r.currency,
    basis: r.basis,
  }));

  const usageBasedResources: UsageBasedResult[] = stack.usageBasedResources.map((r) => ({
    logicalId: r.logicalId,
    type: r.type,
    unitPrice: r.unitPrice,
    unit: r.unit,
    currency: r.currency,
    note: 'Usage-based — provide estimate via --usage-file',
  }));

  const estimatedResources: EstimatedResult[] = stack.estimatedResources.map((r) => ({
    logicalId: r.logicalId,
    type: r.type,
    estimatedMonthlyCost: r.estimatedMonthlyCost,
    currency: r.currency,
    basis: r.basis,
    unitPrice: r.unitPrice,
    unit: r.unit,
  }));

  const conditionalResources: ConditionalResult[] = stack.conditionalResources.map((r) => ({
    logicalId: r.logicalId,
    type: r.type,
    conditionName: r.conditionName,
    monthlyCost: r.monthlyCost,
    currency: r.currency,
    note: 'Excluded from total — gated by CloudFormation Condition',
  }));

  return {
    stackId: stack.stackId,
    region: stack.region,
    regionSource: stack.regionSource,
    resources,
    usageBasedResources,
    estimatedResources,
    conditionalResources,
    unsupportedTypes: stack.unsupportedTypes,
    stackMonthlyCost: stack.stackMonthlyCost,
  };
}

export function formatJson(stacks: PricedStack[], startTime: number): string {
  const now = Date.now();
  const executionTimeMs = now - startTime;
  const totalMonthlyCost = stacks.reduce((sum, s) => sum + s.stackMonthlyCost, 0);

  const result: BreakdownResult = {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    stackpriceVersion: packageJson.version,
    stacks: stacks.map(toStackResult),
    totalMonthlyCost,
    currency: 'USD',
    summary: buildSummary(stacks, executionTimeMs),
  };

  return JSON.stringify(result, null, 2);
}
