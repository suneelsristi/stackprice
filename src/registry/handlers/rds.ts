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
 * Unknown engine values pass through as-is so the caller can still attempt the query.
 */
const CF_ENGINE_TO_PRICING: Record<string, string | undefined> = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  mariadb: 'MariaDB',
  'oracle-ee': 'Oracle',
  'oracle-se': 'Oracle',
  'oracle-se1': 'Oracle',
  'oracle-se2': 'Oracle',
  'sqlserver-ee': 'SQL Server',
  'sqlserver-se': 'SQL Server',
  'sqlserver-ex': 'SQL Server',
  'sqlserver-web': 'SQL Server',
  'aurora-mysql': 'Aurora MySQL',
  'aurora-postgresql': 'Aurora PostgreSQL',
};

export const rdsHandler: ResourceHandler = {
  resourceType: 'AWS::RDS::DBInstance',
  isUsageBased: false,

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const instanceClass = properties['DBInstanceClass'];
    if (typeof instanceClass !== 'string') return null;

    const engine = properties['Engine'];
    if (typeof engine !== 'string') return null;

    const multiAZRaw = properties['MultiAZ'];
    const multiAZ = typeof multiAZRaw === 'boolean' ? multiAZRaw : false;

    const databaseEngine = CF_ENGINE_TO_PRICING[engine] ?? engine;

    return { instanceType: instanceClass, databaseEngine, multiAZ } satisfies RdsAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as RdsAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;
    const multiAZStr = attrs.multiAZ ? 'Yes' : 'No';
    const deploymentOption = attrs.multiAZ ? 'Multi-AZ' : 'Single-AZ';

    return {
      serviceCode: 'AmazonRDS',
      filters: [
        { field: 'instanceType', value: attrs.instanceType },
        { field: 'databaseEngine', value: attrs.databaseEngine },
        { field: 'multiAZ', value: multiAZStr },
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
