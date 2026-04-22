import type { ResourceRecord } from '../template/types.js';
import type { PricingQuery, PricingApiResult } from '../pricing/types.js';

// ─── Region → AWS Pricing API location name ───────────────────────────────────

export const REGION_TO_LOCATION: Record<string, string | undefined> = {
  // United States
  'us-east-1':      'US East (N. Virginia)',
  'us-east-2':      'US East (Ohio)',
  'us-west-1':      'US West (N. California)',
  'us-west-2':      'US West (Oregon)',
  // Europe — NOTE: AWS Pricing API uses "EU" not "Europe" for these regions
  'eu-west-1':      'EU (Ireland)',
  'eu-west-2':      'EU (London)',
  'eu-west-3':      'EU (Paris)',
  'eu-central-1':   'EU (Frankfurt)',
  'eu-central-2':   'Europe (Zurich)',
  'eu-north-1':     'EU (Stockholm)',
  'eu-south-1':     'EU (Milan)',
  'eu-south-2':     'Europe (Spain)',
  // Asia Pacific
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-southeast-3': 'Asia Pacific (Jakarta)',
  'ap-southeast-4': 'Asia Pacific (Melbourne)',
  'ap-southeast-5': 'Asia Pacific (Malaysia)',
  'ap-southeast-6': 'Asia Pacific (Thailand)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ap-south-1':     'Asia Pacific (Mumbai)',
  'ap-south-2':     'Asia Pacific (Hyderabad)',
  'ap-east-1':      'Asia Pacific (Hong Kong)',
  'ap-east-2':      'Asia Pacific (Taipei)',
  // Canada
  'ca-central-1':   'Canada (Central)',
  'ca-west-1':      'Canada West (Calgary)',
  // South America
  'sa-east-1':      'South America (Sao Paulo)',
  // Africa
  'af-south-1':     'Africa (Cape Town)',
  // Middle East
  'me-south-1':     'Middle East (Bahrain)',
  'me-central-1':   'Middle East (UAE)',
  // Israel
  'il-central-1':   'Israel (Tel Aviv)',
  // Mexico
  'mx-central-1':   'Mexico (Central)',
  // GovCloud
  'us-gov-east-1':  'AWS GovCloud (US-East)',
  'us-gov-west-1':  'AWS GovCloud (US-West)',
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
