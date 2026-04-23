import { describe, it, expect } from 'vitest';
import { ec2Handler } from '../../../../src/registry/handlers/ec2.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyInstance', type: 'AWS::EC2::Instance', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.096, unit: 'Hrs', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ec2Handler', () => {
  it('has the correct resourceType', () => {
    expect(ec2Handler.resourceType).toBe('AWS::EC2::Instance');
  });

  it('pricingType is fixed', () => {
    expect(ec2Handler.pricingType).toBe('fixed');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns attributes for a valid resource', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large', Tenancy: 'dedicated' }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['instanceType']).toBe('m5.large');
      expect(attrs!['tenancy']).toBe('dedicated');
      expect(attrs!['operatingSystem']).toBe('Linux');
    });

    it('returns null when InstanceType is missing', () => {
      expect(ec2Handler.extractPricingAttributes(makeResource({}))).toBeNull();
    });

    it('returns null when InstanceType is not a string', () => {
      expect(
        ec2Handler.extractPricingAttributes(makeResource({ InstanceType: 42 })),
      ).toBeNull();
    });

    it('defaults Tenancy to "Shared" when the property is absent', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 't3.micro' }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['tenancy']).toBe('Shared');
    });

    it('defaults Tenancy to "Shared" when the property has wrong type', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 't3.micro', Tenancy: true }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['tenancy']).toBe('Shared');
    });

    it('always sets operatingSystem to "Linux"', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.xlarge' }),
      );
      expect(attrs!['operatingSystem']).toBe('Linux');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonEC2', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonEC2');
    });

    it('includes instanceType, operatingSystem, tenancy filters', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'c5.2xlarge', Tenancy: 'host' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['instanceType']).toBe('c5.2xlarge');
      expect(fields['operatingSystem']).toBe('Linux');
      expect(fields['tenancy']).toBe('host');
    });

    it('sets capacitystatus=Used and preInstalledSw=NA', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['capacitystatus']).toBe('Used');
      expect(fields['preInstalledSw']).toBe('NA');
    });

    it('maps us-east-1 to the correct location name', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps ap-southeast-1 to Asia Pacific (Singapore)', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'ap-southeast-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Asia Pacific (Singapore)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = ec2Handler.extractPricingAttributes(
        makeResource({ InstanceType: 'm5.large' }),
      )!;
      const query = ec2Handler.buildPricingQuery(attrs, 'xx-unknown-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-unknown-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 730 for unit Hrs', () => {
      const price = ec2Handler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.096 }));
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.096 * 730);
    });

    it('preserves currency and unit in the result', () => {
      const price = ec2Handler.calculateMonthlyCost(makeResult({ currency: 'USD' }));
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('Hrs');
    });

    it('returns null for a non-Hrs unit', () => {
      expect(ec2Handler.calculateMonthlyCost(makeResult({ unit: 'GB-Mo' }))).toBeNull();
    });

    it('returns null for empty string unit', () => {
      expect(ec2Handler.calculateMonthlyCost(makeResult({ unit: '' }))).toBeNull();
    });

    it('calculates correctly for a zero pricePerUnit', () => {
      const price = ec2Handler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }));
      expect(price!.amount).toBe(0);
    });
  });
});
