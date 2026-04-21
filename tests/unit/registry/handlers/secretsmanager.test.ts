import { describe, it, expect } from 'vitest';
import { secretsManagerHandler } from '../../../../src/registry/handlers/secretsmanager.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MySecret', type: 'AWS::SecretsManager::Secret', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.4, unit: 'Secrets', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('secretsManagerHandler', () => {
  it('has the correct resourceType', () => {
    expect(secretsManagerHandler.resourceType).toBe('AWS::SecretsManager::Secret');
  });

  it('isUsageBased is false', () => {
    expect(secretsManagerHandler.isUsageBased).toBe(false);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('always returns an empty object', () => {
      expect(secretsManagerHandler.extractPricingAttributes(makeResource())).toEqual({});
    });

    it('never returns null', () => {
      expect(secretsManagerHandler.extractPricingAttributes(makeResource())).not.toBeNull();
    });

    it('returns {} regardless of resource properties', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(
        makeResource({ Name: 'my-secret', Description: 'a secret', KmsKeyId: 'arn:aws:kms:...' }),
      );
      expect(attrs).toEqual({});
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AWSSecretsManager', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      expect(secretsManagerHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AWSSecretsManager',
      );
    });

    it('always includes location filter', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'us-east-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('location');
    });

    it('maps us-east-1 location to US East (N. Virginia)', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('includes usagetype filter for us-east-1 (known prefix USE1)', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'us-east-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('usagetype');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-AWSSecretsManager-Secrets');
    });

    it('includes usagetype filter for eu-west-1 with EU prefix', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EU-AWSSecretsManager-Secrets');
    });

    it('includes usagetype filter for eu-central-1 with EUC1 prefix', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'eu-central-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EUC1-AWSSecretsManager-Secrets');
    });

    it('omits usagetype filter for ap-southeast-1 (null prefix)', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'ap-southeast-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).not.toContain('usagetype');
    });

    it('includes location filter for ap-southeast-1 even though usagetype is omitted', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'ap-southeast-1');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('location');
    });

    it('omits usagetype filter for unknown regions — graceful fallback', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'xx-region-1');
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).not.toContain('usagetype');
    });

    it('passes through unknown region as location value', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'xx-region-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-region-1');
    });

    it('produces two filters for a known region with prefix: location and usagetype', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters).toHaveLength(2);
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('location');
      expect(fieldNames).toContain('usagetype');
    });

    it('produces one filter for ap-southeast-1 (null prefix): location only', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'ap-southeast-1');
      expect(query.filters).toHaveLength(1);
    });

    it('produces one filter for unknown region: location only', () => {
      const attrs = secretsManagerHandler.extractPricingAttributes(makeResource());
      const query = secretsManagerHandler.buildPricingQuery(attrs, 'xx-region-1');
      expect(query.filters).toHaveLength(1);
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 1 when unit is Secrets', () => {
      const result = secretsManagerHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.4 }));
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(0.4);
    });

    it('preserves currency from result', () => {
      const result = secretsManagerHandler.calculateMonthlyCost(makeResult({ currency: 'USD' }));
      expect(result!.currency).toBe('USD');
    });

    it('preserves unit from result', () => {
      const result = secretsManagerHandler.calculateMonthlyCost(makeResult());
      expect(result!.unit).toBe('Secrets');
    });

    it('returns null when unit is not Secrets', () => {
      expect(secretsManagerHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null for arbitrary wrong unit', () => {
      expect(
        secretsManagerHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' })),
      ).toBeNull();
    });

    it('cost is exactly pricePerUnit (multiplier is 1)', () => {
      const result = secretsManagerHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.73 }));
      expect(result!.amount).toBe(0.73);
    });
  });
});
