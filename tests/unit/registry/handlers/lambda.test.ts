import { describe, it, expect } from 'vitest';
import { lambdaHandler } from '../../../../src/registry/handlers/lambda.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyFunction', type: 'AWS::Lambda::Function', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.0000166667, unit: 'Lambda-GB-Second', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('lambdaHandler', () => {
  it('has the correct resourceType', () => {
    expect(lambdaHandler.resourceType).toBe('AWS::Lambda::Function');
  });

  it('is usage-based', () => {
    expect(lambdaHandler.isUsageBased).toBe(true);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns attributes for a valid resource with explicit values', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ MemorySize: 512, Architectures: ['arm64'] }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['memorySize']).toBe(512);
      expect(attrs!['architecture']).toBe('arm64');
    });

    it('defaults MemorySize to 128 when absent', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}));
      expect(attrs).not.toBeNull();
      expect(attrs!['memorySize']).toBe(128);
    });

    it('defaults MemorySize to 128 when wrong type', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ MemorySize: 'big' }),
      );
      expect(attrs!['memorySize']).toBe(128);
    });

    it('defaults architecture to x86_64 when Architectures is absent', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}));
      expect(attrs!['architecture']).toBe('x86_64');
    });

    it('defaults architecture to x86_64 when Architectures is not an array', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ Architectures: 'arm64' }),
      );
      expect(attrs!['architecture']).toBe('x86_64');
    });

    it('defaults architecture to x86_64 when Architectures is an empty array', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ Architectures: [] }),
      );
      expect(attrs!['architecture']).toBe('x86_64');
    });

    it('picks architecture from first element of Architectures array', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ Architectures: ['arm64'] }),
      );
      expect(attrs!['architecture']).toBe('arm64');
    });

    it('returns null for CDK internal Lambda with Handler __entrypoint__.handler', () => {
      expect(
        lambdaHandler.extractPricingAttributes(
          makeResource({ Handler: '__entrypoint__.handler', MemorySize: 128 }),
        ),
      ).toBeNull();
    });

    it('does not skip when Handler is a different value', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ Handler: 'index.handler', MemorySize: 256 }),
      );
      expect(attrs).not.toBeNull();
    });

    it('does not skip when Handler is absent', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({ MemorySize: 512 }));
      expect(attrs).not.toBeNull();
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AWSLambda', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.serviceCode).toBe('AWSLambda');
    });

    it('includes group=AWS-Lambda-Duration filter', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['group']).toBe('AWS-Lambda-Duration');
    });

    it('includes memorysize filter with MB suffix', () => {
      const attrs = lambdaHandler.extractPricingAttributes(
        makeResource({ MemorySize: 256 }),
      )!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['memorysize']).toBe('256 MB');
    });

    it('includes memorysize filter with MB suffix for default 128', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['memorysize']).toBe('128 MB');
    });

    it('maps us-east-1 to the correct location name', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps eu-central-1 to Europe (Frankfurt)', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'eu-central-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Europe (Frankfurt)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = lambdaHandler.extractPricingAttributes(makeResource({}))!;
      const query = lambdaHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-unknown-1');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns null — usage-based handler', () => {
      expect(lambdaHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(lambdaHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(lambdaHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
    });
  });
});
