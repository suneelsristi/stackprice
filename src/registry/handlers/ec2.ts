import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface Ec2Attributes extends PricingAttributes {
  instanceType: string;
  operatingSystem: string;
  tenancy: string;
}

export const ec2Handler: ResourceHandler = {
  resourceType: 'AWS::EC2::Instance',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const instanceType = properties['InstanceType'];
    if (typeof instanceType !== 'string') return null;

    const tenancyRaw = properties['Tenancy'];
    const tenancy = typeof tenancyRaw === 'string' ? tenancyRaw : 'Shared';

    return { instanceType, operatingSystem: 'Linux', tenancy } satisfies Ec2Attributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as Ec2Attributes;
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AmazonEC2',
      filters: [
        { field: 'instanceType', value: attrs.instanceType },
        { field: 'operatingSystem', value: attrs.operatingSystem },
        { field: 'tenancy', value: attrs.tenancy },
        { field: 'location', value: location },
        { field: 'capacitystatus', value: 'Used' },
        { field: 'preInstalledSw', value: 'NA' },
      ],
    };
  },

  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null {
    if (result.unit !== 'Hrs') return null;
    return {
      amount: result.pricePerUnit * 730,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
