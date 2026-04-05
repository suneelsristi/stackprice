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

    // ProvisionedThroughput present → PROVISIONED regardless of BillingMode field.
    const provisionedRaw = properties['ProvisionedThroughput'];
    if (typeof provisionedRaw === 'object' && provisionedRaw !== null) {
      const throughput = provisionedRaw as Record<string, unknown>;
      const readCapacityUnits = throughput['ReadCapacityUnits'];
      const writeCapacityUnits = throughput['WriteCapacityUnits'];

      if (typeof readCapacityUnits !== 'number') return null;
      if (typeof writeCapacityUnits !== 'number') return null;

      return {
        billingMode: 'PROVISIONED',
        isUsageBased: false,
        readCapacityUnits,
        writeCapacityUnits,
      } satisfies DynamoDbAttributes;
    }

    // Explicit PAY_PER_REQUEST billing mode.
    if (properties['BillingMode'] === 'PAY_PER_REQUEST') {
      return { billingMode: 'PAY_PER_REQUEST', isUsageBased: true } satisfies DynamoDbAttributes;
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
