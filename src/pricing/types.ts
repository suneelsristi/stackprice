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
  estimatedResources: EstimatedResource[];
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

export interface ResourceUsage {
  requests_per_month?: number;
  avg_duration_ms?: number;
  memory_mb?: number;
  storage_gb?: number;
  data_transfer_gb?: number;
  monthly_requests?: number;
  monthly_transfer_gb?: number;
  ingestion_gb?: number;
  monthly_transitions?: number;
}

export type UsageFile = Record<string, ResourceUsage>;

export interface EstimatedResource {
  logicalId: string;
  type: string;
  estimatedMonthlyCost: number;
  currency: 'USD';
  basis: string;
  unitPrice: number;
  unit: string;
}
