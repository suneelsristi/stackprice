import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

// Maps AWS region codes to the usagetype prefix used in Kinesis Streams pricing.
// us-east-1 uses NO prefix — undefined means omit the prefix entirely.
const REGION_TO_KINESIS_PREFIX: Record<string, string | undefined> = {
  'us-east-1':      undefined,
  'us-east-2':      'USE2',
  'us-west-1':      'USW1',
  'us-west-2':      'USW2',
  'eu-west-1':      'EU',
  'eu-west-2':      'EUW2',
  'eu-west-3':      'EUW3',
  'eu-central-1':   'EUC1',
  'eu-central-2':   'EUC2',
  'eu-north-1':     'EUN1',
  'eu-south-1':     'EUS1',
  'eu-south-2':     'EUS2',
  'ap-southeast-1': 'APS1',
  'ap-southeast-2': 'APS2',
  'ap-southeast-3': 'APS3',
  'ap-southeast-4': 'APS4',
  'ap-southeast-5': 'APS5',
  'ap-southeast-6': 'APS6',
  'ap-southeast-7': 'APS7',
  'ap-southeast-8': 'APS8',
  'ap-southeast-9': 'APS9',
  'ap-northeast-1': 'APN1',
  'ap-northeast-2': 'APN2',
  'ap-northeast-3': 'APN3',
  'ap-south-1':     'APS1',
  'ap-south-2':     'APS2',
  'ap-east-1':      'APE1',
  'ap-east-2':      'APE2',
  'ca-central-1':   'CAN1',
  'ca-west-1':      'CAN2',
  'sa-east-1':      'SAE1',
  'af-south-1':     'AFS1',
  'me-south-1':     'MES1',
  'me-central-1':   'MEC1',
  'il-central-1':   'ILC1',
  'mx-central-1':   'MXC1',
  'us-gov-east-1':  'UGE1',
  'us-gov-west-1':  'UGW1',
};

export const kinesisHandler: ResourceHandler = {
  resourceType: 'AWS::Kinesis::Stream',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes {
    const props = resource.properties;
    const streamModeDetails = props['StreamModeDetails'];
    let streamMode: string = 'PROVISIONED';
    if (
      streamModeDetails !== null &&
      typeof streamModeDetails === 'object' &&
      !Array.isArray(streamModeDetails)
    ) {
      const details = streamModeDetails as Record<string, unknown>;
      if (typeof details['StreamMode'] === 'string') {
        streamMode = details['StreamMode'];
      }
    }

    const rawShardCount = props['ShardCount'];
    const shardCount = typeof rawShardCount === 'number' ? rawShardCount : 1;

    return { streamMode, shardCount };
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const location = REGION_TO_LOCATION[region] ?? region;
    const isOnDemand = attributes['streamMode'] === 'ON_DEMAND';

    const filters: PricingQuery['filters'] = [
      { field: 'productFamily', value: 'Kinesis Streams' },
      { field: 'location', value: location },
    ];

    if (region in REGION_TO_KINESIS_PREFIX) {
      const prefix = REGION_TO_KINESIS_PREFIX[region];
      if (isOnDemand) {
        const usagetype = prefix ? `${prefix}-OnDemand-StreamHour` : 'OnDemand-StreamHour';
        filters.push({ field: 'usagetype', value: usagetype });
      } else {
        const usagetype = prefix ? `${prefix}-Storage-ShardHour` : 'Storage-ShardHour';
        filters.push({ field: 'usagetype', value: usagetype });
      }
    }
    // unknown region: omit usagetype filter (graceful fallback)

    return { serviceCode: 'AmazonKinesis', filters };
  },

  calculateMonthlyCost(result: PricingApiResult, attrs?: PricingAttributes): MonthlyPrice | null {
    const streamMode = attrs?.['streamMode'];
    const isOnDemand = streamMode === 'ON_DEMAND';

    if (isOnDemand) {
      if (result.unit !== 'StreamHr') return null;
      return {
        amount: result.pricePerUnit * 730,
        currency: result.currency,
        unit: result.unit,
      };
    }

    if (result.unit !== 'ShardHour') return null;
    const shardCount = typeof attrs?.['shardCount'] === 'number' ? (attrs['shardCount'] as number) : 1;
    return {
      amount: result.pricePerUnit * 730 * shardCount,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
