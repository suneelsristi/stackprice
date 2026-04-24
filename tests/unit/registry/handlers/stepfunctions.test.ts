import { describe, it, expect } from 'vitest';
import { stepFunctionsHandler } from '../../../../src/registry/handlers/stepfunctions.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown> = {}): ResourceRecord {
  return { logicalId: 'MyStateMachine', type: 'AWS::StepFunctions::StateMachine', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.000025, unit: 'StateTransitions', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('stepFunctionsHandler', () => {
  it('has the correct resourceType', () => {
    expect(stepFunctionsHandler.resourceType).toBe('AWS::StepFunctions::StateMachine');
  });

  it('pricingType is usage-based', () => {
    expect(stepFunctionsHandler.pricingType).toBe('usage-based');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('detects STANDARD when StateMachineType is "STANDARD"', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'STANDARD' }),
      );
      expect(attrs).toMatchObject({ stateMachineType: 'STANDARD' });
    });

    it('detects EXPRESS when StateMachineType is "EXPRESS"', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      expect(attrs).toMatchObject({ stateMachineType: 'EXPRESS' });
    });

    it('defaults to STANDARD when StateMachineType is absent', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      expect(attrs).toMatchObject({ stateMachineType: 'STANDARD' });
    });

    it('defaults to STANDARD for unrecognised StateMachineType values', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'UNKNOWN' }),
      );
      expect(attrs).toMatchObject({ stateMachineType: 'STANDARD' });
    });

    it('never returns null', () => {
      expect(stepFunctionsHandler.extractPricingAttributes(makeResource())).not.toBeNull();
      expect(
        stepFunctionsHandler.extractPricingAttributes(makeResource({ StateMachineType: 'EXPRESS' })),
      ).not.toBeNull();
    });
  });

  // ─── buildPricingQuery (STANDARD) ──────────────────────────────────────────

  describe('buildPricingQuery (STANDARD)', () => {
    it('uses serviceCode AmazonStates', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      expect(stepFunctionsHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonStates',
      );
    });

    it('sets usagetype to "USE1-StateTransition" for us-east-1', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-StateTransition');
    });

    it('sets usagetype to "EU-StateTransition" for eu-west-1', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EU-StateTransition');
    });

    it('omits usagetype filter for an unknown region', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      expect(query.filters).toHaveLength(0);
    });

    it('includes exactly one filter for a known region', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(makeResource());
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'us-west-2');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('usagetype');
      expect(query.filters[0]!.value).toBe('USW2-StateTransition');
    });
  });

  // ─── buildPricingQuery (EXPRESS) ──────────────────────────────────────────

  describe('buildPricingQuery (EXPRESS)', () => {
    it('uses serviceCode AmazonStates', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      expect(stepFunctionsHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonStates',
      );
    });

    it('sets usagetype to "USE1-StepFunctions-Request" for us-east-1', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'us-east-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('USE1-StepFunctions-Request');
    });

    it('sets usagetype to "EU-StepFunctions-Request" for eu-west-1', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'eu-west-1');
      const usagetype = query.filters.find((f) => f.field === 'usagetype')?.value;
      expect(usagetype).toBe('EU-StepFunctions-Request');
    });

    it('omits usagetype filter for an unknown region', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'xx-unknown-1');
      expect(query.filters).toHaveLength(0);
    });

    it('includes exactly one filter for a known region', () => {
      const attrs = stepFunctionsHandler.extractPricingAttributes(
        makeResource({ StateMachineType: 'EXPRESS' }),
      );
      const query = stepFunctionsHandler.buildPricingQuery(attrs, 'ap-east-1');
      expect(query.filters).toHaveLength(1);
      expect(query.filters[0]!.field).toBe('usagetype');
      expect(query.filters[0]!.value).toBe('APE1-StepFunctions-Request');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('always returns null', () => {
      expect(stepFunctionsHandler.calculateMonthlyCost(makeResult())).toBeNull();
    });

    it('returns null regardless of unit', () => {
      expect(
        stepFunctionsHandler.calculateMonthlyCost(makeResult({ unit: 'StateTransitions' })),
      ).toBeNull();
      expect(
        stepFunctionsHandler.calculateMonthlyCost(makeResult({ unit: 'Requests' })),
      ).toBeNull();
    });

    it('returns null regardless of pricePerUnit', () => {
      expect(
        stepFunctionsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 })),
      ).toBeNull();
      expect(
        stepFunctionsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.000025 })),
      ).toBeNull();
    });
  });
});
