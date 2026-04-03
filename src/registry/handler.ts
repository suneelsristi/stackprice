import type { ResourceRecord } from '../template/types.js';
import type { PricingQuery, PricingApiResult } from '../pricing/types.js';

// ─── Region → AWS Pricing API location name ───────────────────────────────────

export const REGION_TO_LOCATION: Record<string, string | undefined> = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-central-1': 'Europe (Frankfurt)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ca-central-1': 'Canada (Central)',
  'sa-east-1': 'South America (Sao Paulo)',
};

// ─── Shared handler types ─────────────────────────────────────────────────────

/**
 * Attributes extracted from a CloudFormation resource, keyed by field name.
 * `isUsageBased` is an optional per-resource override of the handler's default.
 * When present, the engine uses this value instead of `ResourceHandler.isUsageBased`.
 */
export interface PricingAttributes {
  isUsageBased?: boolean;
  [key: string]: unknown;
}

/** Calculated monthly cost for a priced resource. */
export interface MonthlyPrice {
  amount: number;
  currency: string;
  unit: string;
}

// ─── Handler interface ────────────────────────────────────────────────────────

export interface ResourceHandler {
  /** CloudFormation resource type, e.g. "AWS::EC2::Instance" */
  readonly resourceType: string;

  /**
   * Handler-level default. true means pricing is per-request/usage-based and
   * a fixed monthly amount cannot be determined without usage data.
   * Per-resource overrides live in PricingAttributes.isUsageBased.
   */
  readonly isUsageBased: boolean;

  /**
   * Extract the attributes needed to build a pricing query from a raw
   * CloudFormation resource record.
   * Returns null if required properties are absent or have unexpected types.
   */
  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null;

  /**
   * Build an AWS Pricing API query from the extracted attributes and region.
   * Must not perform any network calls.
   */
  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery;

  /**
   * Compute the monthly cost from a single Pricing API result.
   * Returns null if the result has an unexpected unit or is otherwise unusable.
   */
  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null;
}
