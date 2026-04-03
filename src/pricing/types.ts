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
