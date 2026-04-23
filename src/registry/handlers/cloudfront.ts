import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';

export const cloudFrontHandler: ResourceHandler = {
  resourceType: 'AWS::CloudFront::Distribution',
  pricingType: 'usage-based',

  extractPricingAttributes(_resource: ResourceRecord): PricingAttributes {
    return {};
  },

  buildPricingQuery(_attributes: PricingAttributes, _region: string): PricingQuery {
    // CloudFront uses geographic zone pricing (US, EU, AP, etc.), not AWS regions.
    // v0.5.0: always uses US zone pricing as the baseline rate.
    return {
      serviceCode: 'AmazonCloudFront',
      filters: [
        { field: 'usagetype', value: 'US-Requests-Tier1' },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
