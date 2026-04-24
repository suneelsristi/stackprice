import { describe, it, expect } from 'vitest';
import { kinesisHandler } from '../../../../src/registry/handlers/kinesis.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';
import type { ResourceRecord } from '../../../../src/template/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(overrides: Partial<Record<string, unknown>> = {}): ResourceRecord {
  return {
    logicalId: 'MyKinesisStream',
    type: 'AWS::Kinesis::Stream',
    properties: { ...overrides },
  };
}

function makeResult(unit: string, pricePerUnit = 0.015): PricingApiResult {
  return { pricePerUnit, unit, currency: 'USD' };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('kinesisHandler', () => {
  it('has pricingType: fixed', () => {
    expect(kinesisHandler.pricingType).toBe('fixed');
  });

  it('has resourceType: AWS::Kinesis::Stream', () => {
    expect(kinesisHandler.resourceType).toBe('AWS::Kinesis::Stream');
  });

  describe('extractPricingAttributes', () => {
    it('detects PROVISIONED mode from StreamModeDetails', () => {
      const resource = makeResource({
        StreamModeDetails: { StreamMode: 'PROVISIONED' },
        ShardCount: 2,
      });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('PROVISIONED');
    });

    it('detects ON_DEMAND mode from StreamModeDetails', () => {
      const resource = makeResource({
        StreamModeDetails: { StreamMode: 'ON_DEMAND' },
      });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('ON_DEMAND');
    });

    it('defaults to PROVISIONED when StreamModeDetails absent', () => {
      const resource = makeResource({ ShardCount: 3 });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('PROVISIONED');
    });

    it('extracts ShardCount correctly', () => {
      const resource = makeResource({ ShardCount: 5 });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['shardCount']).toBe(5);
    });

    it('defaults ShardCount to 1 when absent', () => {
      const resource = makeResource({});
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['shardCount']).toBe(1);
    });

    it('defaults to PROVISIONED when StreamModeDetails is a non-object value', () => {
      const resource = makeResource({ StreamModeDetails: 'invalid' });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('PROVISIONED');
    });

    it('defaults to PROVISIONED when StreamModeDetails is an array', () => {
      const resource = makeResource({ StreamModeDetails: ['PROVISIONED'] });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('PROVISIONED');
    });

    it('defaults to PROVISIONED when StreamModeDetails object has non-string StreamMode', () => {
      const resource = makeResource({ StreamModeDetails: { StreamMode: 42 } });
      const attrs = kinesisHandler.extractPricingAttributes(resource);
      expect(attrs?.['streamMode']).toBe('PROVISIONED');
    });

    it('never returns null', () => {
      expect(kinesisHandler.extractPricingAttributes(makeResource())).not.toBeNull();
      expect(kinesisHandler.extractPricingAttributes(makeResource({ ShardCount: 3 }))).not.toBeNull();
    });
  });

  describe('buildPricingQuery (PROVISIONED)', () => {
    const provisionedAttrs = { streamMode: 'PROVISIONED', shardCount: 1 };

    it('us-east-1: usagetype = "Storage-ShardHour" (no prefix)', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'us-east-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('Storage-ShardHour');
    });

    it('eu-west-1: usagetype = "EU-Storage-ShardHour"', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'eu-west-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('EU-Storage-ShardHour');
    });

    it('us-west-2: usagetype = "USW2-Storage-ShardHour"', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'us-west-2');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('USW2-Storage-ShardHour');
    });

    it('unknown region: usagetype filter omitted', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'xx-unknown-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter).toBeUndefined();
    });

    it('always includes location filter', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location');
      expect(loc?.value).toBe('US East (N. Virginia)');
    });

    it('always includes productFamily filter', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'us-east-1');
      const pf = query.filters.find((f) => f.field === 'productFamily');
      expect(pf?.value).toBe('Kinesis Streams');
    });

    it('uses serviceCode AmazonKinesis', () => {
      const query = kinesisHandler.buildPricingQuery(provisionedAttrs, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonKinesis');
    });
  });

  describe('buildPricingQuery (ON_DEMAND)', () => {
    const onDemandAttrs = { streamMode: 'ON_DEMAND', shardCount: 1 };

    it('us-east-1: usagetype = "OnDemand-StreamHour" (no prefix)', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'us-east-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('OnDemand-StreamHour');
    });

    it('eu-west-1: usagetype = "EU-OnDemand-StreamHour"', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'eu-west-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('EU-OnDemand-StreamHour');
    });

    it('ap-northeast-1: usagetype = "APN1-OnDemand-StreamHour"', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'ap-northeast-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter?.value).toBe('APN1-OnDemand-StreamHour');
    });

    it('unknown region: usagetype filter omitted', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'xx-unknown-1');
      const usageFilter = query.filters.find((f) => f.field === 'usagetype');
      expect(usageFilter).toBeUndefined();
    });

    it('always includes location filter', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'eu-west-1');
      const loc = query.filters.find((f) => f.field === 'location');
      expect(loc?.value).toBe('EU (Ireland)');
    });

    it('uses serviceCode AmazonKinesis', () => {
      const query = kinesisHandler.buildPricingQuery(onDemandAttrs, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonKinesis');
    });
  });

  describe('calculateMonthlyCost (PROVISIONED)', () => {
    it('1 shard: pricePerUnit × 730 × 1', () => {
      const attrs = { streamMode: 'PROVISIONED', shardCount: 1 };
      const result = kinesisHandler.calculateMonthlyCost(makeResult('ShardHour', 0.015), attrs);
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(0.015 * 730 * 1, 5);
      expect(result!.currency).toBe('USD');
      expect(result!.unit).toBe('ShardHour');
    });

    it('3 shards: pricePerUnit × 730 × 3', () => {
      const attrs = { streamMode: 'PROVISIONED', shardCount: 3 };
      const result = kinesisHandler.calculateMonthlyCost(makeResult('ShardHour', 0.015), attrs);
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(0.015 * 730 * 3, 5);
    });

    it('wrong unit: returns null', () => {
      const attrs = { streamMode: 'PROVISIONED', shardCount: 1 };
      expect(kinesisHandler.calculateMonthlyCost(makeResult('StreamHr', 0.015), attrs)).toBeNull();
    });

    it('defaults shardCount to 1 when attrs absent', () => {
      const result = kinesisHandler.calculateMonthlyCost(makeResult('ShardHour', 0.015));
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(0.015 * 730, 5);
    });
  });

  describe('calculateMonthlyCost (ON_DEMAND)', () => {
    it('pricePerUnit × 730', () => {
      const attrs = { streamMode: 'ON_DEMAND', shardCount: 1 };
      const result = kinesisHandler.calculateMonthlyCost(makeResult('StreamHr', 0.04), attrs);
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(0.04 * 730, 5);
      expect(result!.currency).toBe('USD');
      expect(result!.unit).toBe('StreamHr');
    });

    it('wrong unit: returns null', () => {
      const attrs = { streamMode: 'ON_DEMAND', shardCount: 1 };
      expect(kinesisHandler.calculateMonthlyCost(makeResult('ShardHour', 0.04), attrs)).toBeNull();
    });
  });
});
