import type { ResourceRecord } from '../../template/types.js';
import type { PricingQuery, PricingApiResult } from '../../pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../handler.js';
import { REGION_TO_LOCATION } from '../handler.js';

interface EcsAttributes extends PricingAttributes {
  cpu: string;
  memory: string;
}

/** Maps Fargate CPU unit strings to the vCPU format required by the AWS Pricing API. */
const CPU_UNITS_TO_VCPU: Record<string, string> = {
  '256': '0.25 vCPU',
  '512': '0.5 vCPU',
  '1024': '1 vCPU',
  '2048': '2 vCPU',
  '4096': '4 vCPU',
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
  isUsageBased: false,

  extractPricingAttributes(resource: ResourceRecord): PricingAttributes | null {
    const { properties } = resource;

    const requires = properties['RequiresCompatibilities'];
    if (!requiresFargate(requires)) return null;

    const cpu = properties['Cpu'];
    if (typeof cpu !== 'string') return null;

    const memory = properties['Memory'];
    if (typeof memory !== 'string') return null;

    return { cpu, memory } satisfies EcsAttributes;
  },

  buildPricingQuery(attributes: PricingAttributes, region: string): PricingQuery {
    const attrs = attributes as EcsAttributes;
    const location = REGION_TO_LOCATION[region] ?? region;
    const vcpu = CPU_UNITS_TO_VCPU[attrs.cpu] ?? attrs.cpu;

    return {
      serviceCode: 'AmazonECS',
      filters: [
        { field: 'cputype', value: vcpu },
        { field: 'location', value: location },
      ],
    };
  },

  /**
   * Returns the monthly cost based on the per-vCPU-hour rate from the API.
   * Note: this is the cost for 1 vCPU × 730 hours. The engine multiplies by
   * the actual fractional vCPU count from EcsAttributes.cpu when applicable.
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
