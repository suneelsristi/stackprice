import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface ApiGatewayAttributes extends PricingAttributes {
  endpointType: 'REGIONAL' | 'EDGE' | 'PRIVATE';
}

// Maps AWS region codes to the usagetype prefix used in API Gateway pricing.
// Format: "{prefix}-ApiGatewayRequest"
const REGION_TO_APIGW_PREFIX: Record<string, string> = {
  'us-east-1': 'USE1',
  'us-east-2': 'USE2',
  'us-west-1': 'USW1',
  'us-west-2': 'USW2',
  'eu-west-1': 'EU',
  'eu-west-2': 'EUW2',
  'eu-west-3': 'EUW3',
  'eu-central-1': 'EUC1',
  'eu-central-2': 'EUC2',
  'eu-north-1': 'EUN1',
  'eu-south-1': 'EUS1',
  'eu-south-2': 'EUS2',
  'ap-southeast-1': 'APS1',
  'ap-southeast-2': 'APS2',
  'ap-southeast-3': 'APS3',
  'ap-southeast-4': 'APS4',
  'ap-northeast-1': 'APN1',
  'ap-northeast-2': 'APN2',
  'ap-northeast-3': 'APN3',
  'ap-east-1': 'APE1',
  'ap-east-2': 'APE2',
  'ap-south-1': 'APS5',
  'ca-central-1': 'CAN1',
  'ca-west-1': 'CAN2',
  'sa-east-1': 'SAE1',
  'af-south-1': 'AFS1',
  'me-south-1': 'MES1',
  'me-central-1': 'MEC1',
  'il-central-1': 'ILC1',
  'mx-central-1': 'MXC1',
};

export const apigatewayHandler: ResourceHandler = {
  resourceType: 'AWS::ApiGateway::RestApi',
  isUsageBased: true,

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    let endpointType: 'REGIONAL' | 'EDGE' | 'PRIVATE' = 'EDGE';

    const endpointConfig = properties['EndpointConfiguration'];
    if (endpointConfig !== undefined && endpointConfig !== null) {
      if (typeof endpointConfig === 'object' && !Array.isArray(endpointConfig)) {
        const config = endpointConfig as Record<string, unknown>;
        const types = config['Types'];
        if (Array.isArray(types) && types.length > 0 && typeof types[0] === 'string') {
          const first = types[0] as string;
          if (first === 'REGIONAL' || first === 'EDGE' || first === 'PRIVATE') {
            endpointType = first;
          }
        }
      }
    }

    return { endpointType } satisfies ApiGatewayAttributes;
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const location = REGION_TO_LOCATION[region] ?? region;
    const prefix = REGION_TO_APIGW_PREFIX[region];

    const filters: PricingQuery['filters'] = [
      { field: 'productFamily', value: 'API Calls' },
      { field: 'location', value: location },
    ];

    if (prefix !== undefined) {
      filters.push({ field: 'usagetype', value: `${prefix}-ApiGatewayRequest` });
    }

    return { serviceCode: 'AmazonApiGateway', filters };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
