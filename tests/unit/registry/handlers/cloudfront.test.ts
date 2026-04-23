import { describe, it, expect } from 'vitest';
import { cloudFrontHandler } from '../../../../src/registry/handlers/cloudfront.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MyDistribution', type: 'AWS::CloudFront::Distribution', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.00000075, unit: 'Requests', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cloudFrontHandler', () => {
  it('has the correct resourceType', () => {
    expect(cloudFrontHandler.resourceType).toBe('AWS::CloudFront::Distribution');
  });

  it('pricingType is usage-based', () => {
    expect(cloudFrontHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('always returns {}', () => {
      expect(cloudFrontHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('returns {} regardless of resource properties', () => {
      expect(
        cloudFrontHandler.extractPricingAttributes(
          makeResource({ DistributionConfig: { Comment: 'test', PriceClass: 'PriceClass_All' } }),
        ),
      ).toEqual({});
    });

    it('never returns null', () => {
      expect(cloudFrontHandler.extractPricingAttributes(makeResource())).not.toBeNull();
      expect(
        cloudFrontHandler.extractPricingAttributes(makeResource({ SomeProperty: 'value' })),
      ).not.toBeNull();
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonCloudFront', () => {
      const attrs = cloudFrontHandler.extractPricingAttributes(makeResource());
      expect(cloudFrontHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonCloudFront',
      );
    });

    it('sets usagetype filter to US-Requests-Tier1', () => {
      const attrs = cloudFrontHandler.extractPricingAttributes(makeResource());
      const query = cloudFrontHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('US-Requests-Tier1');
    });

    it('does not include a location filter', () => {
      const attrs = cloudFrontHandler.extractPricingAttributes(makeResource());
      const query = cloudFrontHandler.buildPricingQuery(attrs, 'us-east-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).not.toContain('location');
    });

    it('produces exactly one filter: usagetype', () => {
      const attrs = cloudFrontHandler.extractPricingAttributes(makeResource());
      const query = cloudFrontHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('usagetype');
      expect(query.filters[0]!.value).toBe('US-Requests-Tier1');
    });

    it('uses the same query regardless of AWS region (zone-based pricing)', () => {
      const attrs = cloudFrontHandler.extractPricingAttributes(makeResource());
      const usEast = cloudFrontHandler.buildPricingQuery(attrs, 'us-east-1');
      const euWest = cloudFrontHandler.buildPricingQuery(attrs, 'eu-west-1');
      const apSouth = cloudFrontHandler.buildPricingQuery(attrs, 'ap-south-1');
      expect(usEast).toEqual(euWest);
      expect(usEast).toEqual(apSouth);
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('always returns null', () => {
      expect(cloudFrontHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(cloudFrontHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' }))).toBeNull();
      expect(cloudFrontHandler.calculateMonthlyCost(makeResult({ unit: 'GB' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(cloudFrontHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
      expect(
        cloudFrontHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 9.99 })),
      ).toBeNull();
    });
  });
});
