import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface RdsAttributes extends PricingAttributes {
  instanceType: string;
  databaseEngine: string;
  multiAZ: boolean;
}

/**
 * Maps CloudFormation Engine property values to AWS Pricing API databaseEngine filter values.
 * Engines not in this map cause extractPricingAttributes to return null.
 */
const CF_ENGINE_TO_PRICING: Record<string, string> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  mariadb: 'MariaDB',
  'oracle-ee': 'Oracle',
  'oracle-se2': 'Oracle',
  'sqlserver-ex': 'SQL Server',
  'sqlserver-web': 'SQL Server',
  'sqlserver-se': 'SQL Server',
  'sqlserver-ee': 'SQL Server',
};

export const rdsHandler: ResourceHandler = {
  resourceType: 'AWS::RDS::DBInstance',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const instanceClass = properties['DBInstanceClass'];
    if (typeof instanceClass !== 'string') return null;

    const engine = properties['Engine'];
    if (typeof engine !== 'string') return null;

    const multiAZRaw = properties['MultiAZ'];
    const multiAZ = typeof multiAZRaw === 'boolean' ? multiAZRaw : false;

    const databaseEngine = CF_ENGINE_TO_PRICING[engine];
    if (databaseEngine === undefined) return null;

    return { instanceType: instanceClass, databaseEngine, multiAZ } satisfies RdsAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as RdsAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;
    const deploymentOption = attrs.multiAZ ? 'Multi-AZ' : 'Single-AZ';

    return {
      serviceCode: 'AmazonRDS',
      filters: [
        { field: 'instanceType', value: attrs.instanceType },
        { field: 'databaseEngine', value: attrs.databaseEngine },
        { field: 'deploymentOption', value: deploymentOption },
        { field: 'location', value: location },
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
