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
  return { pricePerUnit: 0.04048, unit: 'Hrs', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ecsHandler', () => {
  it('has the correct resourceType', () => {
    expect(ecsHandler.resourceType).toBe('AWS::ECS::TaskDefinition');
  });

  it('is not usage-based', () => {
    expect(ecsHandler.isUsageBased).toBe(false);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns attributes for a valid Fargate resource', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource());
      expect(attrs).not.toBeNull();
      expect(attrs!['cpu']).toBe('256');
      expect(attrs!['memory']).toBe('512');
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

    it('returns null when Memory is missing', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({ RequiresCompatibilities: ['FARGATE'], Cpu: '256' }),
        ),
      ).toBeNull();
    });

    it('returns null when Memory is not a string', () => {
      expect(
        ecsHandler.extractPricingAttributes(
          makeResource({
            RequiresCompatibilities: ['FARGATE'],
            Cpu: '256',
            Memory: 512,
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

    it('extracts larger cpu/memory values', () => {
      const attrs = ecsHandler.extractPricingAttributes(
        makeFargateResource({ Cpu: '4096', Memory: '30720' }),
      );
      expect(attrs!['cpu']).toBe('4096');
      expect(attrs!['memory']).toBe('30720');
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

    it('converts Cpu=256 to cputype=0.25 vCPU', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '256' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('0.25 vCPU');
    });

    it('converts Cpu=512 to cputype=0.5 vCPU', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '512' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('0.5 vCPU');
    });

    it('converts Cpu=1024 to cputype=1 vCPU', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '1024' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('1 vCPU');
    });

    it('converts Cpu=2048 to cputype=2 vCPU', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '2048' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('2 vCPU');
    });

    it('converts Cpu=4096 to cputype=4 vCPU', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '4096' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('4 vCPU');
    });

    it('passes through unknown cpu unit values unchanged', () => {
      const attrs = ecsHandler.extractPricingAttributes(makeFargateResource({ Cpu: '8192' }))!;
      const query = ecsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cputype']).toBe('8192');
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
    it('returns pricePerUnit × 730 for unit Hrs', () => {
      const price = ecsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.04048 }));
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.04048 * 730);
    });

    it('preserves currency and unit', () => {
      const price = ecsHandler.calculateMonthlyCost(makeResult());
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('Hrs');
    });

    it('returns null for a non-Hrs unit', () => {
      expect(ecsHandler.calculateMonthlyCost(makeResult({ unit: 'vCPU-Hours' }))).toBeNull();
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
