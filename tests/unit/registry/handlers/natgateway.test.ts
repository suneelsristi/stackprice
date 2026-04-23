import { describe, it, expect } from 'vitest';
import { natGatewayHandler } from '../../../../src/registry/handlers/natgateway.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';
import type { ResourceRecord } from '../../../../src/template/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(): ResourceRecord {
  return { logicalId: 'MyNatGateway', type: 'AWS::EC2::NatGateway', properties: {} };
}

function makeResult(unit: string, pricePerUnit = 0.045): PricingApiResult {
  return { pricePerUnit, unit, currency: 'USD' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('natGatewayHandler', () => {
  it('has pricingType: mixed', () => {
    expect(natGatewayHandler.pricingType).toBe('mixed');
  });

  it('has resourceType: AWS::EC2::NatGateway', () => {
    expect(natGatewayHandler.resourceType).toBe('AWS::EC2::NatGateway');
  });

  describe('extractPricingAttributes', () => {
    it('always returns {}', () => {
      expect(natGatewayHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('never returns null', () => {
      expect(natGatewayHandler.extractPricingAttributes(makeResource())).not.toBeNull();
    });
  });

  describe('buildPricingQuery (hourly)', () => {
    it('us-east-1: usagetype = "RegionalNatGateway-Hours" (no prefix)', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'us-east-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('RegionalNatGateway-Hours');
    });

    it('eu-west-1: usagetype = "EU-RegionalNatGateway-Hours"', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'eu-west-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('EU-RegionalNatGateway-Hours');
    });

    it('us-west-2: usagetype = "USW2-RegionalNatGateway-Hours"', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'us-west-2');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('USW2-RegionalNatGateway-Hours');
    });

    it('unknown region: usagetype filter omitted', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'xx-unknown-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter).toBeUndefined();
    });

    it('always includes productFamily filter', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'us-east-1');
      const pf = query.filters.find((f) => f.field === 'productFamily');
      expect(pf?.value).toBe('NAT Gateway');
    });

    it('always includes location filter', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location');
      expect(loc?.value).toBe('US East (N. Virginia)');
    });

    it('uses serviceCode AmazonEC2', () => {
      const query = natGatewayHandler.buildPricingQuery({}, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonEC2');
    });
  });

  describe('buildUsagePricingQuery (bytes)', () => {
    it('us-east-1: usagetype = "USE1-RegionalNatGateway-Bytes"', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'us-east-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('USE1-RegionalNatGateway-Bytes');
    });

    it('eu-west-1: usagetype = "EU-RegionalNatGateway-Bytes"', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'eu-west-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('EU-RegionalNatGateway-Bytes');
    });

    it('unknown region: usagetype filter omitted', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'xx-unknown-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter).toBeUndefined();
    });

    it('always includes productFamily filter', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'us-east-1');
      const pf = query.filters.find((f) => f.field === 'productFamily');
      expect(pf?.value).toBe('NAT Gateway');
    });

    it('always includes location filter', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'eu-west-1');
      const loc = query.filters.find((f) => f.field === 'location');
      expect(loc?.value).toBe('EU (Ireland)');
    });

    it('uses serviceCode AmazonEC2', () => {
      const query = natGatewayHandler.buildUsagePricingQuery!({}, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonEC2');
    });
  });

  describe('calculateMonthlyCost', () => {
    it('unit=Hrs: returns pricePerUnit × 730', () => {
      const result = natGatewayHandler.calculateMonthlyCost(makeResult('Hrs', 0.045));
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(0.045 * 730, 5);
      expect(result!.currency).toBe('USD');
      expect(result!.unit).toBe('Hrs');
    });

    it('wrong unit: returns null', () => {
      expect(natGatewayHandler.calculateMonthlyCost(makeResult('GB'))).toBeNull();
    });

    it('wrong unit "GB-Mo": returns null', () => {
      expect(natGatewayHandler.calculateMonthlyCost(makeResult('GB-Mo'))).toBeNull();
    });
  });
});
