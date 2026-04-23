import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface ElastiCacheAttributes extends PricingAttributes {
  instanceType: string;
  cacheEngine: string;
  numCacheNodes: number;
}

/**
 * Maps CloudFormation Engine property values to AWS Pricing API cacheEngine filter values.
 * Engines not in this map cause extractPricingAttributes to return null.
 */
const CF_ENGINE_TO_PRICING: Record<string, string> = {
  redis: 'Redis',
  memcached: 'Memcached',
};

export const elasticacheHandler: ResourceHandler = {
  resourceType: 'AWS::ElastiCache::CacheCluster',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const cacheNodeType = properties['CacheNodeType'];
    if (typeof cacheNodeType !== 'string') return null;

    const engine = properties['Engine'];
    if (typeof engine !== 'string') return null;

    const cacheEngine = CF_ENGINE_TO_PRICING[engine];
    if (cacheEngine === undefined) return null;

    const numCacheNodesRaw = properties['NumCacheNodes'];
    const numCacheNodes = typeof numCacheNodesRaw === 'number' ? numCacheNodesRaw : 1;

    return { instanceType: cacheNodeType, cacheEngine, numCacheNodes } satisfies ElastiCacheAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as ElastiCacheAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AmazonElastiCache',
      filters: [
        { field: 'instanceType', value: attrs.instanceType },
        { field: 'cacheEngine', value: attrs.cacheEngine },
        { field: 'location', value: location },
      ],
    };
  },

  /**
   * Returns the per-node monthly cost based on the hourly rate from the API.
   * The engine multiplies by numCacheNodes from ElastiCacheAttributes for the
   * actual total cost across all nodes.
   */
  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null {
    if (result.unit !== 'Hrs') return null;
    return {
      amount: result.pricePerUnit * 730,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
