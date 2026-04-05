import { describe, it, expect } from 'vitest';
import { dynamodbHandler } from '../../../../src/registry/handlers/dynamodb.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyTable', type: 'AWS::DynamoDB::Table', properties };
}

function makeProvisionedResource(rcu = 5, wcu = 5): ResourceRecord {
  return makeResource({
    BillingMode: 'PROVISIONED',
    ProvisionedThroughput: { ReadCapacityUnits: rcu, WriteCapacityUnits: wcu },
  });
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.00013, unit: 'ReadCapacityUnit-Hrs', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dynamodbHandler', () => {
  it('has the correct resourceType', () => {
    expect(dynamodbHandler.resourceType).toBe('AWS::DynamoDB::Table');
  });

  it('handler-level isUsageBased is false', () => {
    expect(dynamodbHandler.isUsageBased).toBe(false);
  });

  // ─── extractPricingAttributes — PAY_PER_REQUEST ─────────────────────────────

  describe('extractPricingAttributes — PAY_PER_REQUEST', () => {
    it('returns attrs with isUsageBased=true when BillingMode is PAY_PER_REQUEST', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['billingMode']).toBe('PAY_PER_REQUEST');
      expect(attrs!['isUsageBased']).toBe(true);
    });

    it('returns null when BillingMode is absent and ProvisionedThroughput is absent', () => {
      expect(dynamodbHandler.extractPricingAttributes(makeResource({}))).toBeNull();
    });

    it('returns null for unknown BillingMode values', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({ BillingMode: 'UNKNOWN_MODE' }),
        ),
      ).toBeNull();
    });

    it('PAY_PER_REQUEST takes precedence even when ProvisionedThroughput is present', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({
          BillingMode: 'PAY_PER_REQUEST',
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['billingMode']).toBe('PAY_PER_REQUEST');
    });
  });

  // ─── extractPricingAttributes — PROVISIONED ─────────────────────────────────

  describe('extractPricingAttributes — PROVISIONED', () => {
    it('returns attrs with isUsageBased=false for PROVISIONED', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(makeProvisionedResource());
      expect(attrs).not.toBeNull();
      expect(attrs!['billingMode']).toBe('PROVISIONED');
      expect(attrs!['isUsageBased']).toBe(false);
    });

    it('treats as PROVISIONED when ProvisionedThroughput present but BillingMode absent', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 } }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['billingMode']).toBe('PROVISIONED');
      expect(attrs!['isUsageBased']).toBe(false);
    });

    it('captures ReadCapacityUnits and WriteCapacityUnits', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeProvisionedResource(10, 20),
      );
      expect(attrs!['readCapacityUnits']).toBe(10);
      expect(attrs!['writeCapacityUnits']).toBe(20);
    });

    it('returns null when ProvisionedThroughput is missing', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({ BillingMode: 'PROVISIONED' }),
        ),
      ).toBeNull();
    });

    it('returns null when ProvisionedThroughput is not an object', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({ BillingMode: 'PROVISIONED', ProvisionedThroughput: 'bad' }),
        ),
      ).toBeNull();
    });

    it('returns null when ProvisionedThroughput is null', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({ BillingMode: 'PROVISIONED', ProvisionedThroughput: null }),
        ),
      ).toBeNull();
    });

    it('returns null when ReadCapacityUnits is missing from ProvisionedThroughput', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({
            BillingMode: 'PROVISIONED',
            ProvisionedThroughput: { WriteCapacityUnits: 5 },
          }),
        ),
      ).toBeNull();
    });

    it('returns null when ReadCapacityUnits is not a number', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({
            BillingMode: 'PROVISIONED',
            ProvisionedThroughput: { ReadCapacityUnits: '5', WriteCapacityUnits: 5 },
          }),
        ),
      ).toBeNull();
    });

    it('returns null when WriteCapacityUnits is not a number', () => {
      expect(
        dynamodbHandler.extractPricingAttributes(
          makeResource({
            BillingMode: 'PROVISIONED',
            ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: '5' },
          }),
        ),
      ).toBeNull();
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonDynamoDB', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      )!;
      expect(dynamodbHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonDynamoDB',
      );
    });

    it('uses group=DDB-RequestUnits for PAY_PER_REQUEST', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      )!;
      const query = dynamodbHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['group']).toBe('DDB-RequestUnits');
    });

    it('uses group=DDB-ReadUnits for PROVISIONED', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(makeProvisionedResource())!;
      const query = dynamodbHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['group']).toBe('DDB-ReadUnits');
    });

    it('maps us-east-2 to US East (Ohio)', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      )!;
      const query = dynamodbHandler.buildPricingQuery(attrs, 'us-east-2');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (Ohio)');
    });

    it('maps ca-central-1 to Canada (Central)', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      )!;
      const query = dynamodbHandler.buildPricingQuery(attrs, 'ca-central-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Canada (Central)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = dynamodbHandler.extractPricingAttributes(
        makeResource({ BillingMode: 'PAY_PER_REQUEST' }),
      )!;
      const query = dynamodbHandler.buildPricingQuery(attrs, 'local-dev-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('local-dev-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 730 for unit ReadCapacityUnit-Hrs (PROVISIONED path)', () => {
      const price = dynamodbHandler.calculateMonthlyCost(
        makeResult({ pricePerUnit: 0.00013 }),
      );
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.00013 * 730);
    });

    it('preserves currency and unit', () => {
      const price = dynamodbHandler.calculateMonthlyCost(makeResult());
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('ReadCapacityUnit-Hrs');
    });

    it('returns null for a non-ReadCapacityUnit-Hrs unit (PAY_PER_REQUEST path)', () => {
      expect(
        dynamodbHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' })),
      ).toBeNull();
    });

    it('returns null for empty string unit', () => {
      expect(dynamodbHandler.calculateMonthlyCost(makeResult({ unit: '' }))).toBeNull();
    });

    it('calculates correctly for a zero pricePerUnit', () => {
      expect(
        dynamodbHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))!.amount,
      ).toBe(0);
    });
  });
});
