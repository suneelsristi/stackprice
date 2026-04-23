import { describe, it, expect } from 'vitest';
import { sqsHandler } from '../../../../src/registry/handlers/sqs.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyQueue', type: 'AWS::SQS::Queue', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.0000004, unit: 'Requests', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('sqsHandler', () => {
  it('has the correct resourceType', () => {
    expect(sqsHandler.resourceType).toBe('AWS::SQS::Queue');
  });

  it('pricingType is usage-based', () => {
    expect(sqsHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns Standard queueType when FifoQueue is absent', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}));
      expect(attrs).not.toBeNull();
      expect(attrs!['queueType']).toBe('Standard');
    });

    it('returns Standard queueType when FifoQueue is false', () => {
      const attrs = sqsHandler.extractPricingAttributes(
        makeResource({ FifoQueue: false }),
      );
      expect(attrs!['queueType']).toBe('Standard');
    });

    it('returns FIFO queueType when FifoQueue is true', () => {
      const attrs = sqsHandler.extractPricingAttributes(
        makeResource({ FifoQueue: true }),
      );
      expect(attrs!['queueType']).toBe('FIFO');
    });

    it('returns Standard when FifoQueue has wrong type', () => {
      const attrs = sqsHandler.extractPricingAttributes(
        makeResource({ FifoQueue: 'yes' }),
      );
      expect(attrs!['queueType']).toBe('Standard');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AWSQueueService', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}))!;
      const query = sqsHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.serviceCode).toBe('AWSQueueService');
    });

    it('includes queueType=Standard filter for standard queue', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}))!;
      const query = sqsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['queueType']).toBe('Standard');
    });

    it('includes queueType=FIFO filter for FIFO queue', () => {
      const attrs = sqsHandler.extractPricingAttributes(
        makeResource({ FifoQueue: true }),
      )!;
      const query = sqsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['queueType']).toBe('FIFO');
    });

    it('maps us-east-1 to the correct location name', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}))!;
      const query = sqsHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps us-west-2 to US West (Oregon)', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}))!;
      const query = sqsHandler.buildPricingQuery(attrs, 'us-west-2');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US West (Oregon)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = sqsHandler.extractPricingAttributes(makeResource({}))!;
      const query = sqsHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-unknown-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns null — usage-based handler', () => {
      expect(sqsHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(sqsHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(sqsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
    });
  });
});
