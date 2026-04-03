import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface LambdaAttributes extends PricingAttributes {
  memorySize: number;
  architecture: string;
}

export const lambdaHandler: ResourceHandler = {
  resourceType: 'AWS::Lambda::Function',
  isUsageBased: true,

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const memorySizeRaw = properties['MemorySize'];
    const memorySize = typeof memorySizeRaw === 'number' ? memorySizeRaw : 128;

    const architecturesRaw = properties['Architectures'];
    let architecture = 'x86_64';
    if (Array.isArray(architecturesRaw) && typeof architecturesRaw[0] === 'string') {
      architecture = architecturesRaw[0];
    }

    return { memorySize, architecture } satisfies LambdaAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as LambdaAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AWSLambda',
      filters: [
        { field: 'group', value: 'AWS-Lambda-Duration' },
        { field: 'memorysize', value: String(attrs.memorySize) },
        { field: 'location', value: location },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
