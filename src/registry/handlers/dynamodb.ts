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
  resourceType: 'AWS::DynamoDB::Table',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    // Explicit PAY_PER_REQUEST billing mode — check first.
    if (properties['BillingMode'] === 'PAY_PER_REQUEST') {
      return { billingMode: 'PAY_PER_REQUEST', pricingType: 'usage-based' } satisfies DynamoDbAttributes;
    }

    // ProvisionedThroughput present → PROVISIONED regardless of BillingMode field.
    // CDK omits BillingMode for PROVISIONED tables and just sets ProvisionedThroughput.
    const provisionedRaw = properties['ProvisionedThroughput'];
    if (typeof provisionedRaw === 'object' && provisionedRaw !== null) {
      const throughput = provisionedRaw as Record<string, unknown>;
      const readCapacityUnits = throughput['ReadCapacityUnits'];
      const writeCapacityUnits = throughput['WriteCapacityUnits'];

      if (typeof readCapacityUnits !== 'number') return null;
      if (typeof writeCapacityUnits !== 'number') return null;

      return {
        billingMode: 'PROVISIONED',
        pricingType: 'fixed',
        readCapacityUnits,
        writeCapacityUnits,
      } satisfies DynamoDbAttributes;
    }

    return null;
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
   * For PROVISIONED tables the API returns an hourly per-RCU rate
   * (unit: "ReadCapacityUnit-Hrs"). Monthly cost = pricePerUnit × 730.
   * The engine multiplies by readCapacityUnits from the extracted attributes.
   * For PAY_PER_REQUEST tables returns null (usage-based, no fixed cost).
   */
  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null {
    if (result.unit !== 'ReadCapacityUnit-Hrs') return null;
    return {
      amount: result.pricePerUnit * 730,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
