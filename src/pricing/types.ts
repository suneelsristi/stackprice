import type { RegionSource } from '../template/types.js';

export interface PricedResource {
  logicalId: string;
  type: string;
  monthlyCost: number;
  currency: 'USD';
  basis: string;
}

export interface UsageBasedResource {
  logicalId: string;
  type: string;
  unitPrice: number;
  unit: string;
  currency: 'USD';
}

export interface PricedConditionalResource {
  logicalId: string;
  type: string;
  conditionName: string;
  monthlyCost: number | null;
  unitPrice?: number;
  unit?: string;
  currency: 'USD';
}

export interface PricedStack {
  stackId: string;
  region: string;
  regionSource: RegionSource;
  pricedResources: PricedResource[];
  usageBasedResources: UsageBasedResource[];
  conditionalResources: PricedConditionalResource[];
  unsupportedTypes: string[];
  stackMonthlyCost: number;
}

export interface PricingQuery {
  serviceCode: string;
  filters: PricingFilter[];
}

export interface PricingFilter {
  field: string;
  value: string;
}

export interface PricingApiResult {
  pricePerUnit: number;
  unit: string;
  currency: string;
}

export interface CacheEntry {
  query: PricingQuery;
  result: PricingApiResult;
  cachedAt: number;
  ttlMs: number;
}
