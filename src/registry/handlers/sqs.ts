import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface SqsAttributes extends PricingAttributes {
  queueType: string;
}

export const sqsHandler: ResourceHandler = {
  resourceType: 'AWS::SQS::Queue',
  pricingType: 'usage-based',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const fifoRaw = properties['FifoQueue'];
    const queueType = fifoRaw === true ? 'FIFO' : 'Standard';

    return { queueType } satisfies SqsAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as SqsAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AWSQueueService',
      filters: [
        { field: 'queueType', value: attrs.queueType },
        { field: 'location', value: location },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
