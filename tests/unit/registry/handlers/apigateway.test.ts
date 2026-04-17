import { describe, it, expect } from 'vitest';
import { apigatewayHandler } from '../../../../src/registry/handlers/apigateway.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyApi', type: 'AWS::ApiGateway::RestApi', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.0000035, unit: 'Requests', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('apigatewayHandler', () => {
  it('has the correct resourceType', () => {
    expect(apigatewayHandler.resourceType).toBe('AWS::ApiGateway::RestApi');
  });

  it('isUsageBased is true', () => {
    expect(apigatewayHandler.isUsageBased).toBe(true);
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns REGIONAL endpoint type when EndpointConfiguration.Types is ["REGIONAL"]', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: ['REGIONAL'] } }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['endpointType']).toBe('REGIONAL');
    });

    it('returns EDGE endpoint type when EndpointConfiguration.Types is ["EDGE"]', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: ['EDGE'] } }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['endpointType']).toBe('EDGE');
    });

    it('returns PRIVATE endpoint type when EndpointConfiguration.Types is ["PRIVATE"]', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: ['PRIVATE'] } }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['endpointType']).toBe('PRIVATE');
    });

    it('defaults to EDGE when EndpointConfiguration is absent', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}));
      expect(attrs).not.toBeNull();
      expect(attrs!['endpointType']).toBe('EDGE');
    });

    it('never returns null — always returns a value', () => {
      expect(apigatewayHandler.extractPricingAttributes(makeResource({}))).not.toBeNull();
      expect(
        apigatewayHandler.extractPricingAttributes(
          makeResource({ EndpointConfiguration: { Types: ['REGIONAL'] } }),
        ),
      ).not.toBeNull();
    });

    it('defaults to EDGE when EndpointConfiguration.Types is empty', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: [] } }),
      );
      expect(attrs!['endpointType']).toBe('EDGE');
    });

    it('defaults to EDGE when EndpointConfiguration.Types first element is not a known type', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: ['UNKNOWN'] } }),
      );
      expect(attrs!['endpointType']).toBe('EDGE');
    });

    it('defaults to EDGE when EndpointConfiguration.Types is not an array', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: { Types: 'REGIONAL' } }),
      );
      expect(attrs!['endpointType']).toBe('EDGE');
    });

    it('defaults to EDGE when EndpointConfiguration is null', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(
        makeResource({ EndpointConfiguration: null }),
      );
      expect(attrs!['endpointType']).toBe('EDGE');
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonApiGateway', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      expect(apigatewayHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonApiGateway',
      );
    });

    it('sets group filter to "Amazon API Gateway - Requests"', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      const query = apigatewayHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['group']).toBe('Amazon API Gateway - Requests');
    });

    it('maps us-east-1 to US East (N. Virginia)', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      const query = apigatewayHandler.buildPricingQuery(attrs, 'us-east-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('US East (N. Virginia)');
    });

    it('maps eu-west-1 to Europe (Ireland)', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      const query = apigatewayHandler.buildPricingQuery(attrs, 'eu-west-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('Europe (Ireland)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      const query = apigatewayHandler.buildPricingQuery(attrs, 'xx-region-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-region-1');
    });

    it('produces exactly two filters: group and location', () => {
      const attrs = apigatewayHandler.extractPricingAttributes(makeResource({}))!;
      const query = apigatewayHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters).toHaveLength(2);
      const fieldNames = query.filters.map((f) => f.field);
      expect(fieldNames).toContain('group');
      expect(fieldNames).toContain('location');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('always returns null for usage-based pricing', () => {
      expect(apigatewayHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(apigatewayHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' }))).toBeNull();
      expect(apigatewayHandler.calculateMonthlyCost(makeResult({ unit: 'Hrs' }))).toBeNull();
    });

    it('returns null regardless of pricePerUnit value', () => {
      expect(apigatewayHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))).toBeNull();
      expect(
        apigatewayHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 9.99 })),
      ).toBeNull();
    });
  });
});
