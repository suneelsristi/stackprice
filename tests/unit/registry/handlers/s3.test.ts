import { describe, it, expect } from 'vitest';
import { s3Handler } from '../../../../src/registry/handlers/s3.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyBucket', type: 'AWS::S3::Bucket', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.023, unit: 'GB-Mo', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('s3Handler', () => {
  it('has the correct resourceType', () => {
    expect(s3Handler.resourceType).toBe('AWS::S3::Bucket');
  });

  it('is usage-based', () => {
    expect(s3Handler.isUsageBased).toBe(true);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('always returns STANDARD storageClass regardless of properties', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}));
      expect(attrs).not.toBeNull();
      expect(attrs!['storageClass']).toBe('STANDARD');
    });

    it('returns STANDARD even when resource has additional properties', () => {
      const attrs = s3Handler.extractPricingAttributes(
        makeResource({ BucketName: 'my-bucket', VersioningConfiguration: { Status: 'Enabled' } }),
      );
      expect(attrs!['storageClass']).toBe('STANDARD');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonS3', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}))!;
      const query = s3Handler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.serviceCode).toBe('AmazonS3');
    });

    it('includes volumeType=Standard filter', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}))!;
      const query = s3Handler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['volumeType']).toBe('Standard');
    });

    it('maps us-east-1 to the correct location name', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}))!;
      const query = s3Handler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps ap-northeast-1 to Asia Pacific (Tokyo)', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}))!;
      const query = s3Handler.buildPricingQuery(attrs, 'ap-northeast-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Asia Pacific (Tokyo)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = s3Handler.extractPricingAttributes(makeResource({}))!;
      const query = s3Handler.buildPricingQuery(attrs, 'xx-unknown-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-unknown-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns null — usage-based handler', () => {
      expect(s3Handler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(s3Handler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(s3Handler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
    });
  });
});
