import { describe, it, expect } from 'vitest';
import { rdsHandler } from '../../../../src/registry/handlers/rds.js';
import type { ResourceRecord } from '../../../../src/template/types.js';
import type { PricingApiResult } from '../../../../src/pricing/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResource(properties: Record<string, unknown>): ResourceRecord {
  return { logicalId: 'MyDB', type: 'AWS::RDS::DBInstance', properties };
}

function makeResult(overrides: Partial<PricingApiResult> = {}): PricingApiResult {
  return { pricePerUnit: 0.24, unit: 'Hrs', currency: 'USD', ...overrides };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rdsHandler', () => {
  it('has the correct resourceType', () => {
    expect(rdsHandler.resourceType).toBe('AWS::RDS::DBInstance');
  });

  it('pricingType is fixed', () => {
    expect(rdsHandler.pricingType).toBe('fixed');
  });

  // ─── extractPricingAttributes ───────────────────────────────────────────────

  describe('extractPricingAttributes', () => {
    it('returns attributes for a valid resource', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: false }),
      );
      expect(attrs).not.toBeNull();
      expect(attrs!['instanceType']).toBe('db.t3.medium');
      expect(attrs!['databaseEngine']).toBe('MySQL');
      expect(attrs!['multiAZ']).toBe(false);
    });

    it('returns null when DBInstanceClass is missing', () => {
      expect(
        rdsHandler.extractPricingAttributes(makeResource({ Engine: 'mysql' })),
      ).toBeNull();
    });

    it('returns null when DBInstanceClass is not a string', () => {
      expect(
        rdsHandler.extractPricingAttributes(
          makeResource({ DBInstanceClass: 42, Engine: 'mysql' }),
        ),
      ).toBeNull();
    });

    it('returns null when Engine is missing', () => {
      expect(
        rdsHandler.extractPricingAttributes(
          makeResource({ DBInstanceClass: 'db.t3.medium' }),
        ),
      ).toBeNull();
    });

    it('returns null when Engine is not a string', () => {
      expect(
        rdsHandler.extractPricingAttributes(
          makeResource({ DBInstanceClass: 'db.t3.medium', Engine: true }),
        ),
      ).toBeNull();
    });

    it('defaults MultiAZ to false when the property is absent', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'postgres' }),
      );
      expect(attrs!['multiAZ']).toBe(false);
    });

    it('defaults MultiAZ to false when the property has wrong type', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: 'yes' }),
      );
      expect(attrs!['multiAZ']).toBe(false);
    });

    it('maps mysql to MySQL', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql' }),
      );
      expect(attrs!['databaseEngine']).toBe('MySQL');
    });

    it('maps postgres to PostgreSQL', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'postgres' }),
      );
      expect(attrs!['databaseEngine']).toBe('PostgreSQL');
    });

    it('maps mariadb to MariaDB', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mariadb' }),
      );
      expect(attrs!['databaseEngine']).toBe('MariaDB');
    });

    it('maps oracle-ee to Oracle', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.r5.large', Engine: 'oracle-ee' }),
      );
      expect(attrs!['databaseEngine']).toBe('Oracle');
    });

    it('maps oracle-se2 to Oracle', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'oracle-se2' }),
      );
      expect(attrs!['databaseEngine']).toBe('Oracle');
    });

    it('maps sqlserver-se to SQL Server', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.m5.large', Engine: 'sqlserver-se' }),
      );
      expect(attrs!['databaseEngine']).toBe('SQL Server');
    });

    it('maps sqlserver-ee to SQL Server', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.m5.large', Engine: 'sqlserver-ee' }),
      );
      expect(attrs!['databaseEngine']).toBe('SQL Server');
    });

    it('maps sqlserver-ex to SQL Server', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.micro', Engine: 'sqlserver-ex' }),
      );
      expect(attrs!['databaseEngine']).toBe('SQL Server');
    });

    it('maps sqlserver-web to SQL Server', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.small', Engine: 'sqlserver-web' }),
      );
      expect(attrs!['databaseEngine']).toBe('SQL Server');
    });

    it('returns null for an unknown engine value', () => {
      expect(
        rdsHandler.extractPricingAttributes(
          makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'custom-engine' }),
        ),
      ).toBeNull();
    });

    it('returns null for aurora-mysql (not in v0.1.0 map)', () => {
      expect(
        rdsHandler.extractPricingAttributes(
          makeResource({ DBInstanceClass: 'db.r5.large', Engine: 'aurora-mysql' }),
        ),
      ).toBeNull();
    });

    it('extracts MultiAZ: true correctly', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: true }),
      );
      expect(attrs!['multiAZ']).toBe(true);
    });
  });

  // ─── buildPricingQuery ──────────────────────────────────────────────────────

  describe('buildPricingQuery', () => {
    it('uses serviceCode AmazonRDS', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql' }),
      )!;
      expect(rdsHandler.buildPricingQuery(attrs, 'us-east-1').serviceCode).toBe(
        'AmazonRDS',
      );
    });

    it('sets instanceType filter to DBInstanceClass value', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.r5.xlarge', Engine: 'postgres' }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['instanceType']).toBe('db.r5.xlarge');
    });

    it('does not include multiAZ filter', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: false }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'us-east-1');
      expect(query.filters.some((f) => f.field === 'multiAZ')).toBe(false);
    });

    it('sets deploymentOption=Single-AZ when MultiAZ is false', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: false }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['deploymentOption']).toBe('Single-AZ');
    });

    it('sets deploymentOption=Multi-AZ when MultiAZ is true', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql', MultiAZ: true }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['deploymentOption']).toBe('Multi-AZ');
    });

    it('maps eu-west-1 to EU (Ireland)', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql' }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'eu-west-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('EU (Ireland)');
    });

    it('passes through unknown regions unchanged', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql' }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'xx-region-1');
      const loc = query.filters.find((f) => f.field === 'location')?.value;
      expect(loc).toBe('xx-region-1');
    });

    it('includes databaseEngine filter with mapped value', () => {
      const attrs = rdsHandler.extractPricingAttributes(
        makeResource({ DBInstanceClass: 'db.t3.medium', Engine: 'mysql' }),
      )!;
      const query = rdsHandler.buildPricingQuery(attrs, 'us-east-1');
      const fields = Object.fromEntries(query.filters.map((f) => [f.field, f.value]));
      expect(fields['databaseEngine']).toBe('MySQL');
    });
  });

  // ─── calculateMonthlyCost ───────────────────────────────────────────────────

  describe('calculateMonthlyCost', () => {
    it('returns pricePerUnit × 730 for unit Hrs', () => {
      const price = rdsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0.24 }));
      expect(price).not.toBeNull();
      expect(price!.amount).toBeCloseTo(0.24 * 730);
    });

    it('preserves currency and unit', () => {
      const price = rdsHandler.calculateMonthlyCost(makeResult());
      expect(price!.currency).toBe('USD');
      expect(price!.unit).toBe('Hrs');
    });

    it('returns null for a non-Hrs unit', () => {
      expect(rdsHandler.calculateMonthlyCost(makeResult({ unit: 'GB-Mo' }))).toBeNull();
    });

    it('returns null for empty string unit', () => {
      expect(rdsHandler.calculateMonthlyCost(makeResult({ unit: '' }))).toBeNull();
    });

    it('calculates correctly for a zero pricePerUnit', () => {
      expect(rdsHandler.calculateMonthlyCost(makeResult({ pricePerUnit: 0 }))!.amount).toBe(
        0,
      );
    });
  });
});
