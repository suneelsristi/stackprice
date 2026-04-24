import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';

// Maps AWS region codes to the usagetype prefix used in Firehose Direct PUT pricing.
// Format: "{prefix}-DirectPUT-no-rounding-BilledBytes"
// NOTE: eu-west-1 uses 'EUW1', not 'EU' — unlike other services.
// Regions not in this map do not support Firehose Direct PUT pricing via the standard usagetype.
const REGION_TO_FIREHOSE_PREFIX: Record<string, string | undefined> = {
  'us-east-1':      'USE1',
  'us-east-2':      'USE2',
  'us-west-2':      'USW2',
  'eu-west-1':      'EUW1',
  'eu-west-2':      'EUW2',
  'eu-west-3':      'EUW3',
  'eu-central-1':   'EUC1',
  'eu-north-1':     'EUN1',
  'ap-southeast-1': 'APS1',
  'ap-southeast-2': 'APS2',
  'ap-southeast-3': 'APS3',
  'ap-southeast-4': 'APS4',
  'ap-southeast-7': 'APS7',
  'ap-southeast-8': 'APS8',
  'ap-southeast-9': 'APS9',
  'ap-northeast-1': 'APN1',
  'ap-northeast-2': 'APN2',
  'ap-northeast-3': 'APN3',
  'ap-east-2':      'APE2',
  'ca-central-1':   'CAN1',
  'sa-east-1':      'SAE1',
  'mx-central-1':   'MXC1',
};

export const firehoseHandler: ResourceHandler = {
  resourceType: 'AWS::KinesisFirehose::DeliveryStream',
  pricingType: 'usage-based',

  extractPricingAttributes(_resource: ResourceRecord): PricingAttributes {
    return {};
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const prefix = REGION_TO_FIREHOSE_PREFIX[region];
    const filters: PricingQuery['filters'] = [];

    if (prefix !== undefined) {
      filters.push({ field: 'usagetype', value: `${prefix}-DirectPUT-no-rounding-BilledBytes` });
    }

    return { serviceCode: 'AmazonKinesisFirehose', filters };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
