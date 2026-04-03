import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface S3Attributes extends PricingAttributes {
  storageClass: string;
}

export const s3Handler: ResourceHandler = {
  resourceType: 'AWS::S3::Bucket',
  isUsageBased: true,

  extractPricingAttributes(_resource: ResourceRecord): PricingAttributes | null {
    return { storageClass: 'STANDARD' } satisfies S3Attributes;
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AmazonS3',
      filters: [
        { field: 'volumeType', value: 'Standard' },
        { field: 'location', value: location },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
