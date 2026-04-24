import { describe, it, expect } from 'vitest';
import { firehoseHandler } from '../../../../src/registry/handlers/firehose.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MyDeliveryStream', type: 'AWS::KinesisFirehose::DeliveryStream', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.08, unit: 'GB', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('firehoseHandler', () => {
  it('has the correct resourceType', () => {
    expect(firehoseHandler.resourceType).toBe('AWS::KinesisFirehose::DeliveryStream');
  });

  it('pricingType is usage-based', () => {
    expect(firehoseHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('always returns {}', () => {
      expect(firehoseHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('returns {} regardless of properties present', () => {
      expect(
        firehoseHandler.extractPricingAttributes(makeResource({ DeliveryStreamType: 'DirectPut' })),
      ).toEqual({});
    });

    it('never returns null', () => {
      expect(firehoseHandler.extractPricingAttributes(makeResource())).not.toBeNull();
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonKinesisFirehose', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      expect(firehoseHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonKinesisFirehose',
      );
    });

    it('sets usagetype to "USE1-DirectPUT-no-rounding-BilledBytes" for us-east-1', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-DirectPUT-no-rounding-BilledBytes');
    });

    it('sets usagetype to "EUW1-DirectPUT-no-rounding-BilledBytes" for eu-west-1 (not EU)', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EUW1-DirectPUT-no-rounding-BilledBytes');
    });

    it('sets usagetype to "USE2-DirectPUT-no-rounding-BilledBytes" for us-east-2', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'us-east-2');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE2-DirectPUT-no-rounding-BilledBytes');
    });

    it('omits usagetype filter for an unknown/unsupported region', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      expect(query.filters).toHaveLength(0);
    });

    it('omits usagetype filter for a region not in the prefix map', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'us-west-1');
      expect(query.filters).toHaveLength(0);
    });

    it('includes exactly one filter for a known region', () => {
      const attrs = firehoseHandler.extractPricingAttributes(makeResource());
      const query = firehoseHandler.buildPricingQuery(attrs, 'us-west-2');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('usagetype');
      expect(query.filters[0]!.value).toBe('USW2-DirectPUT-no-rounding-BilledBytes');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('always returns null', () => {
      expect(firehoseHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(firehoseHandler.calculateMonthlyCost(makeResult({ unit: 'GB' }))).toBeNull();
      expect(firehoseHandler.calculateMonthlyCost(makeResult({ unit: 'Bytes' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit', () => {
      expect(firehoseHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
      expect(firehoseHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.08 }))).toBeNull();
    });
  });
});
