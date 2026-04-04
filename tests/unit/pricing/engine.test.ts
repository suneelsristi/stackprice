import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedStack, ResourceRecord, ConditionalResourceRecord } from '../../../src/template/types.js';
import type { PricingApiResult } from '../../../src/pricing/types.js';
import type { ResourceHandler, PricingAttributes, MonthlyPrice } from '../../../src/registry/handler.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockBuildCacheKey = vi.fn();
const mockGetFromMemory = vi.fn();
const mockGetFromFile = vi.fn();
const mockSetInMemory = vi.fn();
const mockSetInFile = vi.fn();

vi.mock('../../../src/pricing/cache.js', () => ({
  buildCacheKey: (...args: unknown[]): unknown => mockBuildCacheKey(...args),
  getFromMemory: (...args: unknown[]): unknown => mockGetFromMemory(...args),
  getFromFile: (...args: unknown[]): unknown => mockGetFromFile(...args),
  setInMemory: (...args: unknown[]): unknown => mockSetInMemory(...args),
  setInFile: (...args: unknown[]): unknown => mockSetInFile(...args),
}));

const mockFetchPrice = vi.fn();

vi.mock('../../../src/pricing/client.js', () => ({
  fetchPrice: (...args: unknown[]): unknown => mockFetchPrice(...args),
}));

import { priceStacks } from '../../../src/pricing/engine.js';
import { ResourceHandlerRegistry } from '../../../src/registry/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApiResult(pricePerUnit = 0.1, unit = 'Hrs', currency = 'USD'): PricingApiResult {
  return { pricePerUnit, unit, currency };
}

function makeMonthlyPrice(amount: number, unit = 'Hrs', currency = 'USD'): MonthlyPrice {
  return { amount, currency, unit };
}

function makeFixedHandler(overrides: Partial<ResourceHandler> = {}): ResourceHandler {
  return {
    resourceType: 'AWS::EC2::Instance',
    isUsageBased: false,
    extractPricingAttributes: (_r: ResourceRecord) => ({ instanceType: 'm5.large' }),
    buildPricingQuery: (_a: PricingAttributes, region: string) => ({
      serviceCode: 'AmazonEC2',
      filters: [{ field: 'instanceType', value: 'm5.large' }, { field: 'location', value: region }],
    }),
    calculateMonthlyCost: (result: PricingApiResult) => makeMonthlyPrice(result.pricePerUnit * 730),
    ...overrides,
  };
}

function makeUsageHandler(overrides: Partial<ResourceHandler> = {}): ResourceHandler {
  return {
    resourceType: 'AWS::Lambda::Function',
    isUsageBased: true,
    extractPricingAttributes: (_r: ResourceRecord) => ({ memorySize: 128 }),
    buildPricingQuery: (_a: PricingAttributes, region: string) => ({
      serviceCode: 'AWSLambda',
      filters: [{ field: 'location', value: region }],
    }),
    calculateMonthlyCost: (_result: PricingApiResult) => null,
    ...overrides,
  };
}

function makeStack(
  resources: ResourceRecord[] = [],
  conditionalResources: ConditionalResourceRecord[] = [],
): ParsedStack {
  return {
    stackId: 'MyStack',
    region: 'us-east-1',
    regionSource: 'template',
    resources,
    conditionalResources,
    unsupportedTypes: [],
  };
}

function makeResource(logicalId: string, type: string): ResourceRecord {
  return { logicalId, type, properties: {} };
}

function makeConditionalResource(
  logicalId: string,
  type: string,
  conditionName: string,
): ConditionalResourceRecord {
  return { logicalId, type, properties: {}, conditionName };
}

function makeRegistry(...handlers: ResourceHandler[]): ResourceHandlerRegistry {
  const registry = new ResourceHandlerRegistry();
  for (const h of handlers) registry.register(h);
  return registry;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: cache miss
  mockBuildCacheKey.mockReturnValue('us-east-1:AmazonEC2:instanceType=m5.large');
  mockGetFromMemory.mockReturnValue(null);
  mockGetFromFile.mockReturnValue(null);
});

describe('priceStacks', () => {
  describe('happy path', () => {
    it('prices a fixed resource correctly', async () => {
      const apiResult = makeApiResult(0.096, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.pricedResources).toHaveLength(1);
      expect(result!.pricedResources[0]).toMatchObject({
        logicalId: 'Ec2Instance',
        type: 'AWS::EC2::Instance',
        monthlyCost: 0.096 * 730,
        currency: 'USD',
        basis: 'Hrs',
      });
      expect(result!.usageBasedResources).toHaveLength(0);
      expect(result!.conditionalResources).toHaveLength(0);
      expect(result!.stackMonthlyCost).toBeCloseTo(0.096 * 730);
    });

    it('prices a usage-based resource correctly', async () => {
      const apiResult = makeApiResult(0.0000002, 'Requests');
      mockBuildCacheKey.mockReturnValue('us-east-1:AWSLambda:location=us-east-1');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeUsageHandler();
      const stack = makeStack([makeResource('MyLambda', 'AWS::Lambda::Function')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.usageBasedResources).toHaveLength(1);
      expect(result!.usageBasedResources[0]).toMatchObject({
        logicalId: 'MyLambda',
        type: 'AWS::Lambda::Function',
        unitPrice: 0.0000002,
        unit: 'Requests',
        currency: 'USD',
      });
      expect(result!.pricedResources).toHaveLength(0);
      expect(result!.stackMonthlyCost).toBe(0);
    });

    it('prices a conditional resource correctly (fixed)', async () => {
      const apiResult = makeApiResult(0.096, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeFixedHandler();
      const stack = makeStack(
        [],
        [makeConditionalResource('ConditionalEc2', 'AWS::EC2::Instance', 'IsProd')],
      );
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.conditionalResources).toHaveLength(1);
      expect(result!.conditionalResources[0]).toMatchObject({
        logicalId: 'ConditionalEc2',
        type: 'AWS::EC2::Instance',
        conditionName: 'IsProd',
        monthlyCost: 0.096 * 730,
        currency: 'USD',
      });
      expect(result!.pricedResources).toHaveLength(0);
      expect(result!.stackMonthlyCost).toBe(0);
    });

    it('prices a conditional usage-based resource correctly', async () => {
      const apiResult = makeApiResult(0.0000002, 'Requests');
      mockBuildCacheKey.mockReturnValue('us-east-1:AWSLambda:location=us-east-1');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeUsageHandler();
      const stack = makeStack(
        [],
        [makeConditionalResource('ConditionalLambda', 'AWS::Lambda::Function', 'IsEnabled')],
      );
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.conditionalResources).toHaveLength(1);
      expect(result!.conditionalResources[0]).toMatchObject({
        logicalId: 'ConditionalLambda',
        type: 'AWS::Lambda::Function',
        conditionName: 'IsEnabled',
        monthlyCost: null,
        unitPrice: 0.0000002,
        unit: 'Requests',
        currency: 'USD',
      });
    });

    it('handles mixed stack: fixed + usage-based + conditional', async () => {
      const ec2Result = makeApiResult(0.096, 'Hrs');
      const lambdaResult = makeApiResult(0.0000002, 'Requests');

      mockBuildCacheKey
        .mockReturnValueOnce('key-ec2')
        .mockReturnValueOnce('key-lambda')
        .mockReturnValueOnce('key-cond-ec2');

      mockGetFromMemory.mockReturnValue(null);
      mockGetFromFile.mockReturnValue(null);
      mockFetchPrice
        .mockResolvedValueOnce(ec2Result)
        .mockResolvedValueOnce(lambdaResult)
        .mockResolvedValueOnce(ec2Result);

      const ec2Handler = makeFixedHandler();
      const lambdaHandler = makeUsageHandler();

      const stack = makeStack(
        [
          makeResource('Ec2Instance', 'AWS::EC2::Instance'),
          makeResource('MyLambda', 'AWS::Lambda::Function'),
        ],
        [makeConditionalResource('ConditionalEc2', 'AWS::EC2::Instance', 'IsProd')],
      );
      const registry = makeRegistry(ec2Handler, lambdaHandler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.pricedResources).toHaveLength(1);
      expect(result!.usageBasedResources).toHaveLength(1);
      expect(result!.conditionalResources).toHaveLength(1);
      expect(result!.stackMonthlyCost).toBeCloseTo(0.096 * 730);
    });

    it('stackMonthlyCost sums only fixed resources, not usage-based or conditional', async () => {
      const ec2Result = makeApiResult(0.1, 'Hrs');
      const lambdaResult = makeApiResult(0.0000002, 'Requests');

      mockBuildCacheKey
        .mockReturnValueOnce('key-ec2')
        .mockReturnValueOnce('key-lambda')
        .mockReturnValueOnce('key-cond-ec2');

      mockFetchPrice
        .mockResolvedValueOnce(ec2Result)
        .mockResolvedValueOnce(lambdaResult)
        .mockResolvedValueOnce(ec2Result);

      const ec2Handler = makeFixedHandler();
      const lambdaHandler = makeUsageHandler();
      const stack = makeStack(
        [
          makeResource('Ec2A', 'AWS::EC2::Instance'),
          makeResource('LambdaA', 'AWS::Lambda::Function'),
        ],
        [makeConditionalResource('CondEc2', 'AWS::EC2::Instance', 'SomeCond')],
      );
      const registry = makeRegistry(ec2Handler, lambdaHandler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.stackMonthlyCost).toBeCloseTo(0.1 * 730);
    });
  });

  describe('unsupported types', () => {
    it('adds unknown resource type to unsupportedTypes and skips it', async () => {
      const stack = makeStack([makeResource('Bucket', 'AWS::S3::Bucket')]);
      const registry = makeRegistry(); // no handlers

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.unsupportedTypes).toContain('AWS::S3::Bucket');
      expect(result!.pricedResources).toHaveLength(0);
      expect(mockFetchPrice).not.toHaveBeenCalled();
    });

    it('adds type to unsupportedTypes when extractPricingAttributes returns null', async () => {
      const handler = makeFixedHandler({
        extractPricingAttributes: () => null,
      });
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.unsupportedTypes).toContain('AWS::EC2::Instance');
      expect(result!.pricedResources).toHaveLength(0);
      expect(mockFetchPrice).not.toHaveBeenCalled();
    });

    it('deduplicates unsupported types across multiple resources', async () => {
      const stack = makeStack([
        makeResource('Bucket1', 'AWS::S3::Bucket'),
        makeResource('Bucket2', 'AWS::S3::Bucket'),
      ]);
      const registry = makeRegistry();

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.unsupportedTypes.filter((t) => t === 'AWS::S3::Bucket')).toHaveLength(1);
    });
  });

  describe('caching', () => {
    it('uses memory cache hit and skips fetchPrice', async () => {
      const cached = makeApiResult(0.05, 'Hrs');
      mockGetFromMemory.mockReturnValue(cached);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(mockFetchPrice).not.toHaveBeenCalled();
      expect(result!.pricedResources).toHaveLength(1);
      expect(result!.pricedResources[0]!.monthlyCost).toBeCloseTo(0.05 * 730);
    });

    it('falls through to file cache when memory miss, skips fetchPrice', async () => {
      const cached = makeApiResult(0.07, 'Hrs');
      mockGetFromMemory.mockReturnValue(null);
      mockGetFromFile.mockReturnValue(cached);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(mockFetchPrice).not.toHaveBeenCalled();
      expect(result!.pricedResources[0]!.monthlyCost).toBeCloseTo(0.07 * 730);
    });

    it('writes to memory and file cache after a successful fetch', async () => {
      const apiResult = makeApiResult(0.096, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);
      const key = 'us-east-1:AmazonEC2:instanceType=m5.large';
      mockBuildCacheKey.mockReturnValue(key);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      await priceStacks([stack], registry, false);

      expect(mockSetInMemory).toHaveBeenCalledWith(key, apiResult);
      expect(mockSetInFile).toHaveBeenCalledWith(key, 'us-east-1', apiResult);
    });

    it('noCache=true bypasses cache reads and always calls fetchPrice', async () => {
      const apiResult = makeApiResult(0.096, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      await priceStacks([stack], registry, true);

      expect(mockGetFromMemory).not.toHaveBeenCalled();
      expect(mockGetFromFile).not.toHaveBeenCalled();
      expect(mockFetchPrice).toHaveBeenCalledOnce();
    });

    it('noCache=true does not write to cache after fetch', async () => {
      const apiResult = makeApiResult(0.096, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      await priceStacks([stack], registry, true);

      expect(mockSetInMemory).not.toHaveBeenCalled();
      expect(mockSetInFile).not.toHaveBeenCalled();
    });
  });

  describe('Promise.all parallelism', () => {
    it('fires all fetch calls for a stack in one Promise.all batch', async () => {
      const ec2Result = makeApiResult(0.096, 'Hrs');

      mockBuildCacheKey
        .mockReturnValueOnce('key-ec2')
        .mockReturnValueOnce('key-rds');

      let maxConcurrent = 0;
      let pending = 0;

      const delayedFetch = vi.fn().mockImplementation(async () => {
        pending++;
        maxConcurrent = Math.max(maxConcurrent, pending);
        await new Promise((resolve) => setTimeout(resolve, 10));
        pending--;
        return ec2Result;
      });

      mockFetchPrice.mockImplementation(delayedFetch);

      const ec2Handler = makeFixedHandler({ resourceType: 'AWS::EC2::Instance' });
      const rdsHandler = makeFixedHandler({
        resourceType: 'AWS::RDS::DBInstance',
        buildPricingQuery: (_a: PricingAttributes, region: string) => ({
          serviceCode: 'AmazonRDS',
          filters: [{ field: 'location', value: region }],
        }),
        calculateMonthlyCost: (_result: PricingApiResult) => makeMonthlyPrice(_result.pricePerUnit * 730),
      });

      const stack = makeStack([
        makeResource('Ec2Instance', 'AWS::EC2::Instance'),
        makeResource('RdsInstance', 'AWS::RDS::DBInstance'),
      ]);
      const registry = makeRegistry(ec2Handler, rdsHandler);

      await priceStacks([stack], registry, true);

      // Both calls must have been in flight simultaneously
      expect(maxConcurrent).toBe(2);
      expect(delayedFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchPrice null handling', () => {
    it('skips resource silently when fetchPrice returns null', async () => {
      mockFetchPrice.mockResolvedValue(null);

      const handler = makeFixedHandler();
      const stack = makeStack([makeResource('Ec2Instance', 'AWS::EC2::Instance')]);
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.pricedResources).toHaveLength(0);
      expect(result!.unsupportedTypes).toHaveLength(0);
      expect(result!.stackMonthlyCost).toBe(0);
    });

    it('skips conditional resource silently when fetchPrice returns null', async () => {
      mockFetchPrice.mockResolvedValue(null);

      const handler = makeFixedHandler();
      const stack = makeStack(
        [],
        [makeConditionalResource('CondEc2', 'AWS::EC2::Instance', 'IsProd')],
      );
      const registry = makeRegistry(handler);

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.conditionalResources).toHaveLength(0);
    });
  });

  describe('multi-stack', () => {
    it('returns a PricedStack for each input stack', async () => {
      const apiResult = makeApiResult(0.1, 'Hrs');
      mockFetchPrice.mockResolvedValue(apiResult);
      mockBuildCacheKey.mockReturnValue('key');

      const handler = makeFixedHandler();
      const stack1 = { ...makeStack([makeResource('Ec2A', 'AWS::EC2::Instance')]), stackId: 'Stack1' };
      const stack2 = { ...makeStack([makeResource('Ec2B', 'AWS::EC2::Instance')]), stackId: 'Stack2' };
      const registry = makeRegistry(handler);

      const results = await priceStacks([stack1, stack2], registry, true);

      expect(results).toHaveLength(2);
      expect(results[0]!.stackId).toBe('Stack1');
      expect(results[1]!.stackId).toBe('Stack2');
    });
  });

  describe('stack metadata', () => {
    it('passes through stackId, region, and regionSource', async () => {
      const stack = makeStack();
      const registry = makeRegistry();

      const [result] = await priceStacks([stack], registry, false);

      expect(result!.stackId).toBe('MyStack');
      expect(result!.region).toBe('us-east-1');
      expect(result!.regionSource).toBe('template');
    });
  });
});
