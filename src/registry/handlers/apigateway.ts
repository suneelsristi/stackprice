import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

// NOTE: This handler is intentionally not registered in the CLI.
// The AWS Price List API does not expose REST API per-request
// pricing via GetProducts. The handler logic is correct — only
// the pricing data source needs to change.
// See GitHub issue #38 for full analysis and planned fix
// using AWS bulk pricing files in v0.3.0.

interface ApiGatewayAttributes extends PricingAttributes {
  endpointType: 'REGIONAL' | 'EDGE' | 'PRIVATE';
}

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

    return {
      serviceCode: 'AmazonApiGateway',
      filters: [
        { field: 'group', value: 'Amazon API Gateway - Requests' },
        { field: 'location', value: location },
      ],
    };
  },

  calculateMonthlyCost(_result: PricingApiResult): MonthlyPrice | null {
    return null;
  },
};
