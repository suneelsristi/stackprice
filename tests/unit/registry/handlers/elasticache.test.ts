import { describe, it, expect } from 'vitest';
import { elasticacheHandler } from '../../../../src/registry/handlers/elasticache.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyCluster', type: 'AWS::ElastiCache::CacheCluster', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.068, unit: 'Hrs', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('elasticacheHandler', () => {
  it('has the correct resourceType', () => {
    expect(elasticacheHandler.resourceType).toBe('AWS::ElastiCache::CacheCluster');
  });

  it('isUsageBased is false', () => {
    expect(elasticacheHandler.isUsageBased).toBe(false);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('maps redis engine to Redis', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['cacheEngine']).toBe('Redis');
    });

    it('maps memcached engine to Memcached', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'memcached' }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['cacheEngine']).toBe('Memcached');
    });

    it('returns null for an unknown engine', () => {
      expect(
        elasticacheHandler.extractPricingAttributes(
          makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'valkey' }),
        ),
      ).toBeNull();
    });

    it('returns null when CacheNodeType is missing', () => {
      expect(
        elasticacheHandler.extractPricingAttributes(
          makeResource({ Engine: 'redis' }),
        ),
      ).toBeNull();
    });

    it('returns null when CacheNodeType is not a string', () => {
      expect(
        elasticacheHandler.extractPricingAttributes(
          makeResource({ CacheNodeType: 42, Engine: 'redis' }),
        ),
      ).toBeNull();
    });

    it('returns null when Engine is not a string', () => {
      expect(
        elasticacheHandler.extractPricingAttributes(
          makeResource({ CacheNodeType: 'cache.t3.micro', Engine: true }),
        ),
      ).toBeNull();
    });

    it('defaults NumCacheNodes to 1 when absent', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      );
      expect(attrs!['numCacheNodes']).toBe(1);
    });

    it('defaults NumCacheNodes to 1 when value has wrong type', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis', NumCacheNodes: '3' }),
      );
      expect(attrs!['numCacheNodes']).toBe(1);
    });

    it('uses NumCacheNodes when provided as a number', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.m6g.large', Engine: 'memcached', NumCacheNodes: 5 }),
      );
      expect(attrs!['numCacheNodes']).toBe(5);
    });

    it('preserves instanceType from CacheNodeType', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.r6g.xlarge', Engine: 'redis' }),
      );
      expect(attrs!['instanceType']).toBe('cache.r6g.xlarge');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonElastiCache', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      )!;
      expect(elasticacheHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonElastiCache',
      );
    });

    it('sets instanceType filter to CacheNodeType value', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.m6g.large', Engine: 'redis' }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['instanceType']).toBe('cache.m6g.large');
    });

    it('sets cacheEngine filter to mapped engine value', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'memcached' }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['cacheEngine']).toBe('Memcached');
    });

    it('maps us-east-1 to US East (N. Virginia)', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps eu-west-1 to EU (Ireland)', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'eu-west-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('EU (Ireland)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis' }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'xx-region-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-region-1');
    });

    it('does not include numCacheNodes in filters', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis', NumCacheNodes: 3 }),
      )!;
      const query = elasticacheHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters.some((f) => f.field === 'numCacheNodes')).toBe(false);
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('single node: returns pricePerUnit × 730 for unit Hrs', () => {
      const price = elasticacheHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.068 }));
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.068 * 730);
    });

    it('multi-node: numCacheNodes from attrs multiplies the per-node cost', () => {
      const attrs = elasticacheHandler.extractPricingAttributes(
        makeResource({ CacheNodeType: 'cache.t3.micro', Engine: 'redis', NumCacheNodes: 3 }),
      )!;
      const price = elasticacheHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.068 }));
      expect(price).not.toBeNull();
      const numCacheNodes = attrs['numCacheNodes'] as number;
      expect(price!.amount * numCacheNodes).toBeCloseTo(0.068 * 730 * 3);
    });

    it('returns null for a non-Hrs unit', () => {
      expect(
        elasticacheHandler.calculateMonthlyCost(makeResult({ unit: 'GB-Mo' })),
      ).toBeNull();
    });

    it('returns null for an empty string unit', () => {
      expect(
        elasticacheHandler.calculateMonthlyCost(makeResult({ unit: '' })),
      ).toBeNull();
    });

    it('preserves currency and unit in the result', () => {
      const price = elasticacheHandler.calculateMonthlyCost(makeResult());
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('Hrs');
    });

    it('calculates correctly for a zero pricePerUnit', () => {
      expect(
        elasticacheHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))!.amount,
      ).toBe(0);
    });
  });
});
