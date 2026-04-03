import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceHandlerRegistry } from '../../../src/registry/index.js';
import type { ResourceHandler, PricingAttributes } from '../../../src/registry/handler.js';
import type { ResourceRecord } from '../../../src/template/types.js';
import type { PricingQuery, PricingApiResult } from '../../../src/pricing/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeHandler(resourceType: string): ResourceHandler {
  return {
    resourceType,
    isUsageBased: false,
    extractPricingAttributes(_resource: ResourceRecord): PricingAttributes | null {
      return {};
    },
    buildPricingQuery(_attributes: PricingAttributes, _region: string): PricingQuery {
      return { serviceCode: 'test', filters: [] } satisfies PricingQuery;
    },
    calculateMonthlyCost(_result: PricingApiResult): null {
      return null;
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ResourceHandlerRegistry', () => {
  let registry: ResourceHandlerRegistry;

  beforeEach(() => {
    registry = new ResourceHandlerRegistry();
  });

  describe('register / get', () => {
    it('retrieves a registered handler by resource type', () => {
      const handler = makeHandler('AWS::EC2::Instance');
      registry.register(handler);
      expect(registry.get('AWS::EC2::Instance')).toBe(handler);
    });

    it('returns undefined for an unregistered resource type', () => {
      expect(registry.get('AWS::S3::Bucket')).toBeUndefined();
    });

    it('overwrites a previously registered handler for the same type', () => {
      const first = makeHandler('AWS::EC2::Instance');
      const second = makeHandler('AWS::EC2::Instance');
      registry.register(first);
      registry.register(second);
      expect(registry.get('AWS::EC2::Instance')).toBe(second);
    });
  });

  describe('has', () => {
    it('returns true for a registered type', () => {
      registry.register(makeHandler('AWS::RDS::DBInstance'));
      expect(registry.has('AWS::RDS::DBInstance')).toBe(true);
    });

    it('returns false for an unregistered type', () => {
      expect(registry.has('AWS::Lambda::Function')).toBe(false);
    });
  });

  describe('listSupported', () => {
    it('returns an empty array when no handlers are registered', () => {
      expect(registry.listSupported()).toEqual([]);
    });

    it('returns registered types in alphabetical order', () => {
      registry.register(makeHandler('AWS::S3::Bucket'));
      registry.register(makeHandler('AWS::EC2::Instance'));
      registry.register(makeHandler('AWS::DynamoDB::Table'));
      expect(registry.listSupported()).toEqual([
        'AWS::DynamoDB::Table',
        'AWS::EC2::Instance',
        'AWS::S3::Bucket',
      ]);
    });

    it('returns a new array on each call (not a shared reference)', () => {
      registry.register(makeHandler('AWS::EC2::Instance'));
      const first = registry.listSupported();
      const second = registry.listSupported();
      expect(first).not.toBe(second);
    });

    it('lists a single registered type', () => {
      registry.register(makeHandler('AWS::Lambda::Function'));
      expect(registry.listSupported()).toEqual(['AWS::Lambda::Function']);
    });
  });

  describe('independence of multiple registries', () => {
    it('two registry instances do not share state', () => {
      const a = new ResourceHandlerRegistry();
      const b = new ResourceHandlerRegistry();
      a.register(makeHandler('AWS::EC2::Instance'));
      expect(b.has('AWS::EC2::Instance')).toBe(false);
    });
  });
});
