import { describe, it, expect } from 'vitest';
import { snsHandler } from '../../../../src/registry/handlers/sns.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyTopic', type: 'AWS::SNS::Topic', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.0000005, unit: 'Requests', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('snsHandler', () => {
  it('has the correct resourceType', () => {
    expect(snsHandler.resourceType).toBe('AWS::SNS::Topic');
  });

  it('pricingType is usage-based', () => {
    expect(snsHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns Standard topicType when FifoTopic is absent', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}));
      expect(attrs).not.toBeNull();
      expect(attrs!['topicType']).toBe('Standard');
    });

    it('returns Standard topicType when FifoTopic is false', () => {
      const attrs = snsHandler.extractPricingAttributes(
        makeResource({ FifoTopic: false }),
      );
      expect(attrs!['topicType']).toBe('Standard');
    });

    it('returns FIFO topicType when FifoTopic is true', () => {
      const attrs = snsHandler.extractPricingAttributes(
        makeResource({ FifoTopic: true }),
      );
      expect(attrs!['topicType']).toBe('FIFO');
    });

    it('returns Standard when FifoTopic has wrong type', () => {
      const attrs = snsHandler.extractPricingAttributes(
        makeResource({ FifoTopic: 'true' }),
      );
      expect(attrs!['topicType']).toBe('Standard');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonSNS', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}))!;
      const query = snsHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonSNS');
    });

    it('includes group=SNS-Requests-Tier1 filter', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}))!;
      const query = snsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['group']).toBe('SNS-Requests-Tier1');
    });

    it('maps us-east-1 to the correct location name', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}))!;
      const query = snsHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps sa-east-1 to South America (Sao Paulo)', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}))!;
      const query = snsHandler.buildPricingQuery(attrs, 'sa-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('South America (Sao Paulo)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = snsHandler.extractPricingAttributes(makeResource({}))!;
      const query = snsHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-unknown-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns null — usage-based handler', () => {
      expect(snsHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(snsHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(snsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
    });
  });
});
