import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';

interface CloudWatchLogsAttributes extends PricingAttributes {
  retentionDays?: number;
}

// Maps AWS region codes to the usagetype prefix used in CloudWatch Logs pricing.
// Format: "{prefix}-DataProcessing-Bytes" (ingestion) / "{prefix}-TimedStorage-ByteHrs" (storage)
const REGION_TO_CWL_PREFIX: Record<string, string> = {
  'us-east-1':      'USE1',
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

export const cloudWatchLogsHandler: ResourceHandler = {
  resourceType: 'AWS::Logs::LogGroup',
  pricingType: 'usage-based',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes {
    const attrs: CloudWatchLogsAttributes = {};
    const retention = resource.properties['RetentionInDays'];
    if (typeof retention === 'number') {
      attrs.retentionDays = retention;
    }
    return attrs;
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const prefix = REGION_TO_CWL_PREFIX[region];
    const filters: PricingQuery['filters'] = [];

    if (prefix !== undefined) {
      filters.push({ field: 'usagetype', value: `${prefix}-DataProcessing-Bytes` });
    }

    return { serviceCode: 'AmazonCloudWatch', filters };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
