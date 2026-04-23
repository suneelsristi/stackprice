import { describe, it, expect } from 'vitest';
import { ecsHandler } from '../../../../src/registry/handlers/ecs.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyTask', type: 'AWS::ECS::TaskDefinition', properties };
}

function makeFargateResource(overrides: Record<string, unknown> = {}): ResourceRecord {
  return makeResource({
    RequiresCompatibilities: ['FARGATE'],
    Cpu: '256',
    Memory: '512',
    ...overrides,
  });
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.04048, unit: 'hours', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ecsHandler', () => {
  it('has the correct resourceType', () => {
    expect(ecsHandler.resourceType).toBe('AWS::ECS::TaskDefinition');
  });

  it('pricingType is fixed', () => {
    expect(ecsHandler.pricingType).toBe('fixed');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns attributes for a valid Fargate resource', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource());
      expect(attrs).not.toBeNull();
      expect(attrs!['cpuUnits']).toBe('256');
      expect(attrs!['vCpuFraction']).toBe(0.25);
    });

    it('returns null when RequiresCompatibilities is absent', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({ Cpu: '256', Memory: '512' }),
        ),
      ).toBeNull();
    });

    it('returns null when RequiresCompatibilities does not include FARGATE', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({
            RequiresCompatibilities: ['EC2'],
            Cpu: '256',
            Memory: '512',
          }),
        ),
      ).toBeNull();
    });

    it('returns null when RequiresCompatibilities is not an array', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({
            RequiresCompatibilities: 'FARGATE',
            Cpu: '256',
            Memory: '512',
          }),
        ),
      ).toBeNull();
    });

    it('returns null when Cpu is missing', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({ RequiresCompatibilities: ['FARGATE'], Memory: '512' }),
        ),
      ).toBeNull();
    });

    it('returns null when Cpu is not a string', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({
            RequiresCompatibilities: ['FARGATE'],
            Cpu: 256,
            Memory: '512',
          }),
        ),
      ).toBeNull();
    });

    it('returns null when Cpu is not in the known CPU map', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({
            RequiresCompatibilities: ['FARGATE'],
            Cpu: '8192',
            Memory: '16384',
          }),
        ),
      ).toBeNull();
    });

    it('accepts FARGATE alongside EC2 in RequiresCompatibilities', () => {
      const attrs = ecsHandler.extractPricingAttributes(
        makeResource({
          RequiresCompatibilities: ['EC2', 'FARGATE'],
          Cpu: '1024',
          Memory: '2048',
        }),
      );
      expect(attrs).not.toBeNull();
    });

    it('maps Cpu=256 to vCpuFraction=0.25', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '256' }))!;
      expect(attrs['cpuUnits']).toBe('256');
      expect(attrs['vCpuFraction']).toBe(0.25);
    });

    it('maps Cpu=512 to vCpuFraction=0.5', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '512' }))!;
      expect(attrs['vCpuFraction']).toBe(0.5);
    });

    it('maps Cpu=1024 to vCpuFraction=1', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '1024' }))!;
      expect(attrs['vCpuFraction']).toBe(1);
    });

    it('maps Cpu=2048 to vCpuFraction=2', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '2048' }))!;
      expect(attrs['vCpuFraction']).toBe(2);
    });

    it('maps Cpu=4096 to vCpuFraction=4', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '4096' }))!;
      expect(attrs['vCpuFraction']).toBe(4);
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonECS', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource())!;
      expect(ecsHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonECS',
      );
    });

    it('uses cputype=perCPU for all CPU sizes', () => {
      for (const cpu of ['256', '512', '1024', '2048', '4096']) {
        const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: cpu }))!;
        const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
        const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
        expect(fields['cputype']).toBe('perCPU');
      }
    });

    it('has exactly two filters: cputype and location', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource())!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters).toHaveLength(2);
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('cputype');
      expect(fieldNames).toContain('location');
    });

    it('maps us-west-2 to US West (Oregon)', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource())!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-west-2');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US West (Oregon)');
    });

    it('maps ap-northeast-1 to Asia Pacific (Tokyo)', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource())!;
      const query = ecsHandler.buildPricingQuery(attrs, 'ap-northeast-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Asia Pacific (Tokyo)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource())!;
      const query = ecsHandler.buildPricingQuery(attrs, 'zz-custom-9');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('zz-custom-9');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 730 for unit hours', () => {
      const price = ecsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.04048 }));
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.04048 * 730);
    });

    it('preserves currency and unit', () => {
      const price = ecsHandler.calculateMonthlyCost(makeResult());
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('hours');
    });

    it('returns null for a non-hours unit', () => {
      expect(ecsHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null for empty string unit', () => {
      expect(ecsHandler.calculateMonthlyCost(makeResult({ unit: '' }))).toBeNull();
    });

    it('calculates correctly for a zero pricePerUnit', () => {
      expect(
        ecsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))!.amount,
      ).toBe(0);
    });
  });
});
