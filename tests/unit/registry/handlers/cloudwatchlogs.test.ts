import { describe, it, expect } from 'vitest';
import { cloudWatchLogsHandler } from '../../../../src/registry/handlers/cloudwatchlogs.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MyLogGroup', type: 'AWS::Logs::LogGroup', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.50, unit: 'GB', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cloudWatchLogsHandler', () => {
  it('has the correct resourceType', () => {
    expect(cloudWatchLogsHandler.resourceType).toBe('AWS::Logs::LogGroup');
  });

  it('pricingType is usage-based', () => {
    expect(cloudWatchLogsHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('extracts RetentionInDays when present', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(
        makeResource({ RetentionInDays: 30 }),
      );
      expect(attrs).toMatchObject({ retentionDays: 30 });
    });

    it('returns {} when properties are absent', () => {
      expect(cloudWatchLogsHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('ignores RetentionInDays when it is not a number', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(
        makeResource({ RetentionInDays: 'never' }),
      );
      expect(attrs).toEqual({});
    });

    it('never returns null', () => {
      expect(cloudWatchLogsHandler.extractPricingAttributes(makeResource())).not.toBeNull();
      expect(
        cloudWatchLogsHandler.extractPricingAttributes(makeResource({ RetentionInDays: 7 })),
      ).not.toBeNull();
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonCloudWatch', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(makeResource());
      expect(cloudWatchLogsHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonCloudWatch',
      );
    });

    it('sets usagetype to "USE1-DataProcessing-Bytes" for us-east-1', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(makeResource());
      const query = cloudWatchLogsHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-DataProcessing-Bytes');
    });

    it('sets usagetype to "EU-DataProcessing-Bytes" for eu-west-1', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(makeResource());
      const query = cloudWatchLogsHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EU-DataProcessing-Bytes');
    });

    it('omits usagetype filter for an unknown region', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(makeResource());
      const query = cloudWatchLogsHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      expect(query.filters).toHaveLength(0);
    });

    it('includes exactly one filter for a known region', () => {
      const attrs = cloudWatchLogsHandler.extractPricingAttributes(makeResource());
      const query = cloudWatchLogsHandler.buildPricingQuery(attrs, 'us-west-2');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('usagetype');
      expect(query.filters[0]!.value).toBe('USW2-DataProcessing-Bytes');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('always returns null', () => {
      expect(cloudWatchLogsHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(cloudWatchLogsHandler.calculateMonthlyCost(makeResult({ unit: 'GB' }))).toBeNull();
      expect(cloudWatchLogsHandler.calculateMonthlyCost(makeResult({ unit: 'GB-Mo' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit', () => {
      expect(cloudWatchLogsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
      expect(cloudWatchLogsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.50 }))).toBeNull();
    });
  });
});
