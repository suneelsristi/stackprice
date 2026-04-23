import { describe, it, expect } from 'vitest';
import { eksHandler } from '../../../../src/registry/handlers/eks.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MyCluster', type: 'AWS::EKS::Cluster', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.10, unit: 'Hours', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('eksHandler', () => {
  it('has the correct resourceType', () => {
    expect(eksHandler.resourceType).toBe('AWS::EKS::Cluster');
  });

  it('pricingType is fixed', () => {
    expect(eksHandler.pricingType).toBe('fixed');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('always returns an empty object', () => {
      expect(eksHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('never returns null', () => {
      expect(eksHandler.extractPricingAttributes(makeResource())).not.toBeNull();
    });

    it('returns {} regardless of resource properties', () => {
      const attrs = eksHandler.extractPricingAttributes(
        makeResource({ Name: 'my-cluster', Version: '1.29', RoleArn: 'arn:aws:iam::123:role/eks' }),
      );
      expect(attrs).toEqual({});
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonEKS', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      expect(eksHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe('AmazonEKS');
    });

    it('always includes location filter', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'us-east-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('location');
    });

    it('maps us-east-1 location to US East (N. Virginia)', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('includes usagetype filter for us-east-1 (known prefix USE1)', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'us-east-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('usagetype');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-AmazonEKS-Hours:perCluster');
    });

    it('usagetype filter for known region does NOT include "Outposts"', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value ?? '';
      expect(usagetype).not.toContain('Outposts');
    });

    it('includes usagetype filter for eu-west-1 with EU prefix', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EU-AmazonEKS-Hours:perCluster');
    });

    it('includes usagetype filter for ap-northeast-1 with APN1 prefix', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'ap-northeast-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('APN1-AmazonEKS-Hours:perCluster');
    });

    it('omits usagetype filter for unknown regions — graceful fallback', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'xx-region-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).not.toContain('usagetype');
    });

    it('always includes location filter for unknown region', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'xx-region-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('location');
    });

    it('passes through unknown region as location value', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'xx-region-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-region-1');
    });

    it('produces two filters for a known region with prefix: location and usagetype', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'us-west-2');
      expect(query.filters).toHaveLength(2);
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('location');
      expect(fieldNames).toContain('usagetype');
    });

    it('produces one filter for unknown region: location only', () => {
      const attrs = eksHandler.extractPricingAttributes(makeResource());
      const query = eksHandler.buildPricingQuery(attrs, 'xx-region-1');
      expect(query.filters).toHaveLength(1);
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 730 when unit is Hours', () => {
      const result = eksHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.10 }));
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(73, 5);
    });

    it('preserves currency from result', () => {
      const result = eksHandler.calculateMonthlyCost(makeResult({ currency: 'USD' }));
      expect(result!.currency).toBe('USD');
    });

    it('preserves unit from result', () => {
      const result = eksHandler.calculateMonthlyCost(makeResult());
      expect(result!.unit).toBe('Hours');
    });

    it('returns null when unit is not Hours', () => {
      expect(eksHandler.calculateMonthlyCost(makeResult({ unit: 'Secrets' }))).toBeNull();
    });

    it('returns null for arbitrary wrong unit', () => {
      expect(eksHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' }))).toBeNull();
    });

    it('cost is pricePerUnit × 730', () => {
      const result = eksHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.20 }));
      expect(result!.amount).toBeCloseTo(146, 5);
    });
  });
});
