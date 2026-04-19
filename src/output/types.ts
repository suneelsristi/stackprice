export interface BreakdownResult {
  schemaVersion: '1.0';
  timestamp: string;
  stackpriceVersion: string;
  stacks: PricedStackResult[];
  totalMonthlyCost: number;
  currency: 'USD';
  summary: BreakdownSummary;
}

export interface EstimatedResult {
  logicalId: string;
  type: string;
  estimatedMonthlyCost: number;
  currency: 'USD';
  basis: string;
  unitPrice: number;
  unit: string;
}

export interface PricedStackResult {
  stackId: string;
  region: string;
  regionSource: string;
  resources: ResourceResult[];
  usageBasedResources: UsageBasedResult[];
  estimatedResources: EstimatedResult[];
  conditionalResources: ConditionalResult[];
  unsupportedTypes: string[];
  stackMonthlyCost: number;
}

export interface ResourceResult {
  logicalId: string;
  type: string;
  monthlyCost: number;
  currency: 'USD';
  basis: string;
}

export interface UsageBasedResult {
  logicalId: string;
  type: string;
  unitPrice: number;
  unit: string;
  currency: 'USD';
  note: 'Usage-based — provide estimate via --usage-file';
}

export interface ConditionalResult {
  logicalId: string;
  type: string;
  conditionName: string;
  monthlyCost: number | null;
  currency: 'USD';
  note: 'Excluded from total — gated by CloudFormation Condition';
}

export interface BreakdownSummary {
  totalStacks: number;
  totalResources: number;
  pricedResources: number;
  usageBasedResources: number;
  conditionalResources: number;
  unsupportedResources: number;
  executionTimeMs: number;
}
