import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface EcsAttributes extends PricingAttributes {
  cpuUnits: string;
  vCpuFraction: number;
}

/** Maps Fargate CPU unit strings to fractional vCPU values used in cost calculation. */
const CPU_UNITS_TO_VCPU_FRACTION: Record<string, number> = {
  '256': 0.25,
  '512': 0.5,
  '1024': 1,
  '2048': 2,
  '4096': 4,
};

/**
 * Checks that RequiresCompatibilities is an array that includes "FARGATE".
 * Returns false for any other type or value.
 */
function requiresFargate(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((v) => v === 'FARGATE');
}

export const ecsHandler: ResourceHandler = {
  resourceType: 'AWS::ECS::TaskDefinition',
  pricingType: 'fixed',

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const requires = properties['RequiresCompatibilities'];
    if (!requiresFargate(requires)) return null;

    const cpu = properties['Cpu'];
    if (typeof cpu !== 'string') return null;

    const vCpuFraction = CPU_UNITS_TO_VCPU_FRACTION[cpu];
    if (vCpuFraction === undefined) return null;

    return { cpuUnits: cpu, vCpuFraction } satisfies EcsAttributes;
  },

  buildPricingQuery(_attributes: PricingAttributes, region: string): PricingQuery {
    const location = REGION_TO_LOCATION[region] ?? region;

    return {
      serviceCode: 'AmazonECS',
      filters: [
        { field: 'cputype', value: 'perCPU' },
        { field: 'location', value: location },
      ],
    };
  },

  /**
   * Returns the monthly cost based on the per-vCPU-hour rate from the API.
   * The unit from the API is "hours". The engine multiplies by vCpuFraction
   * from EcsAttributes for the actual fractional vCPU count.
   */
  calculateMonthlyCost(result: PricingApiResult): MonthlyPrice | null {
    if (result.unit !== 'hours') return null;
    return {
      amount: result.pricePerUnit * 730,
      currency: result.currency,
      unit: result.unit,
    };
  },
};
