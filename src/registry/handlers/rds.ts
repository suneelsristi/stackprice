import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface RdsAttributes extends PricingAttributes {
  instanceType: string;
  databaseEngine: string;
  multiAZ: boolean;
  allocatedStorage: number;
  storageType: string;
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

/**
 * HARDCODED: RDS storage rates per GB-month, verified against
 * the AWS Pricing API on 2026-04-24.
 *
 * Verification command (run per storage type):
 *   aws pricing get-products --service-code AmazonRDS \
 *     --region us-east-1 \
 *     --filters \
 *       "Type=TERM_MATCH,Field=productFamily,Value=Database Storage" \
 *       "Type=TERM_MATCH,Field=location,Value=US East (N. Virginia)" \
 *       "Type=TERM_MATCH,Field=volumeType,Value=General Purpose" \
 *       "Type=TERM_MATCH,Field=deploymentOption,Value=Single-AZ"
 *
 * If AWS changes storage pricing, update both maps below,
 * update the verified date in this comment, and update the
 * hardcoded pricing table in CLAUDE.md.
 * Reference: https://aws.amazon.com/rds/pricing/
 *
 * Note: Multi-AZ rates are approximately 2× Single-AZ rates.
 * io1 and io2 IOPS charges are NOT included — only storage GB cost.
 */
const STORAGE_RATES_SINGLE_AZ: Record<string, number> = {
  'gp2':      0.115,
  'gp3':      0.115,
  'io1':      0.125,
  'io2':      0.125,
  'standard': 0.100,
};

const STORAGE_RATES_MULTI_AZ: Record<string, number> = {
  'gp2':      0.230,
  'gp3':      0.230,
  'io1':      0.250,
  'io2':      0.250,
  'standard': 0.200,
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

    const allocatedStorageRaw = properties['AllocatedStorage'];
    const allocatedStorage = typeof allocatedStorageRaw === 'number'
      ? Math.floor(allocatedStorageRaw)
      : 20;

    const storageTypeRaw = properties['StorageType'];
    const storageType = typeof storageTypeRaw === 'string'
      ? storageTypeRaw.toLowerCase()
      : 'gp2';

    return { instanceType: instanceClass, databaseEngine, multiAZ, allocatedStorage, storageType } satisfies RdsAttributes;
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

  calculateMonthlyCost(result: PricingApiResult, attrs?: PricingAttributes): MonthlyPrice | null {
    if (result.unit !== 'Hrs') return null;

    const instanceCost = result.pricePerUnit * 730;

    const allocatedStorage = (attrs?.['allocatedStorage'] as number | undefined) ?? 20;
    const storageType = (attrs?.['storageType'] as string | undefined) ?? 'gp2';
    const multiAZ = (attrs?.['multiAZ'] as boolean | undefined) ?? false;

    const rateMap = multiAZ ? STORAGE_RATES_MULTI_AZ : STORAGE_RATES_SINGLE_AZ;
    const storageRate = rateMap[storageType] ?? rateMap['gp2']!;
    const storageCost = allocatedStorage * storageRate;

    return {
      amount: instanceCost + storageCost,
      currency: 'USD',
      unit: result.unit,
    };
  },
};
