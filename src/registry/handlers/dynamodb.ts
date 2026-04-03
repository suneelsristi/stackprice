import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

type BillingMode = 'PAY_PER_REQUEST' | 'PROVISIONED';

interface DynamoDbAttributes extends PricingAttributes {
  billingMode: BillingMode;
  readCapacityUnits?: number;
  writeCapacityUnits?: number;
}

export const dynamodbHandler: ResourceHandler = {
  /**
   * Handler-level default is true because the CloudFormation default BillingMode
   * is PAY_PER_REQUEST, which is usage-based.
   * For PROVISIONED tables, extractPricingAttributes sets isUsageBased: false.
   */
  resourceType: 'AWS::DynamoDB::Table',
  isUsageBased: true,

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const billingModeRaw = properties['BillingMode'];
    const billingMode: BillingMode =
      billingModeRaw === 'PROVISIONED' ? 'PROVISIONED' : 'PAY_PER_REQUEST';

    if (billingMode === 'PAY_PER_REQUEST') {
      return { billingMode, isUsageBased: true } satisfies DynamoDbAttributes;
    }

    // PROVISIONED — ReadCapacityUnits and WriteCapacityUnits are required.
    const rcuRaw = properties['ProvisionedThroughput'];
    if (typeof rcuRaw !== 'object' || rcuRaw === null) return null;

    const throughput = rcuRaw as Record<string, unknown>;
    const readCapacityUnits = throughput['ReadCapacityUnits'];
    const writeCapacityUnits = throughput['WriteCapacityUnits'];

    if (typeof readCapacityUnits !== 'number') return null;
    if (typeof writeCapacityUnits !== 'number') return null;

    return {
      billingMode,
      isUsageBased: false,
      readCapacityUnits,
      writeCapacityUnits,
    } satisfies DynamoDbAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as DynamoDbAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;

    const group =
      attrs.billingMode === 'PROVISIONED' ? 'DDB-ReadUnits' : 'DDB-RequestUnits';

    return {
      serviceCode: 'AmazonDynamoDB',
      filters: [
        { field: 'group', value: group },
        { field: 'location', value: location },
      ],
    };
  },

  /**
   * For PROVISIONED tables the API returns an hourly per-RCU rate (unit: "Hrs").
   * Monthly cost = pricePerUnit × 730.
   * For PAY_PER_REQUEST tables the unit is not "Hrs" so this returns null,
   * consistent with isUsageBased: true for those resources.
   */
  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null {
    if (result.unit !== 'Hrs') return null;
    return {
      amount: result.pricePerUnit * 730,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
