import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface SnsAttributes extends PricingAttributes {
  topicType: string;
}

export const snsHandler: ResourceHandler = {
  resourceType: 'AWS::SNS::Topic',
  pricingType: 'usage-based',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const fifoRaw = properties['FifoTopic'];
    const topicType = fifoRaw === true ? 'FIFO' : 'Standard';

    return { topicType } satisfies SnsAttributes;
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AmazonSNS',
      filters: [
        { field: 'group', value: 'SNS-Requests-Tier1' },
        { field: 'location', value: location },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
