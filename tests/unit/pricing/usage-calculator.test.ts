import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UsageBasedResource } from '../../../src/pricing/types.js';
import { StackPriceError } from '../../../src/errors/index.js';

// ─── fs mock ─────────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]): unknown => mockExistsSync(...args),
    readFileSync: (...args: unknown[]): unknown => mockReadFileSync(...args),
  };
});

// ─── js-yaml mock ─────────────────────────────────────────────────────────────

const mockYamlLoad = vi.fn();

vi.mock('js-yaml', () => ({
  load: (...args: unknown[]): unknown => mockYamlLoad(...args),
}));

import { parseUsageFile, calculateEstimatedCost } from '../../../src/pricing/usage-calculator.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUsageBasedResource(overrides: Partial<UsageBasedResource> = {}): UsageBasedResource {
  return {
    logicalId: 'MyResource',
    type: 'AWS::Lambda::Function',
    unitPrice: 0.0000166667,
    unit: 'GB-second',
    currency: 'USD',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseUsageFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  it('returns correct UsageFile for valid YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('yaml content');
    mockYamlLoad.mockReturnValue({
      MyLambda: { requests_per_month: 5000000, avg_duration_ms: 200, memory_mb: 256 },
      MyBucket: { storage_gb: 500 },
    });

    const result = parseUsageFile('/some/usage.yml');
    expect(result).toEqual({
      MyLambda: { requests_per_month: 5000000, avg_duration_ms: 200, memory_mb: 256 },
      MyBucket: { storage_gb: 500 },
    });
  });

  it('returns empty object for null/empty YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');
    mockYamlLoad.mockReturnValue(null);

    const result = parseUsageFile('/some/usage.yml');
    expect(result).toEqual({});
  });

  it('silently ignores entries with non-number usage values', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('yaml content');
    mockYamlLoad.mockReturnValue({
      MyLambda: { requests_per_month: '5000000' },  // string, not number
      MyBucket: { storage_gb: 500 },
    });

    const result = parseUsageFile('/some/usage.yml');
    expect(result).toEqual({
      MyLambda: {},
      MyBucket: { storage_gb: 500 },
    });
  });

  it('throws StackPriceError when file not found', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => parseUsageFile('/missing/usage.yml')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/missing/usage.yml')).toThrow('Usage file not found');
  });

  it('throws StackPriceError when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('permission denied');
    });

    expect(() => parseUsageFile('/some/usage.yml')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/some/usage.yml')).toThrow('Failed to read usage file');
  });

  it('throws StackPriceError for invalid YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('invalid: yaml: content:');
    mockYamlLoad.mockImplementation(() => {
      throw new Error('bad yaml');
    });

    expect(() => parseUsageFile('/some/usage.yml')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/some/usage.yml')).toThrow('Invalid YAML');
  });

  it('throws StackPriceError when YAML is an array (not a mapping)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('- item');
    mockYamlLoad.mockReturnValue(['item']);

    expect(() => parseUsageFile('/some/usage.yml')).toThrow(StackPriceError);
  });

  it('silently skips entries where value is a primitive (string)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('yaml content');
    mockYamlLoad.mockReturnValue({
      MyLambda: 'not-an-object',   // string, should be omitted entirely
      MyBucket: { storage_gb: 500 },
    });

    const result = parseUsageFile('/some/usage.yml');
    expect(result).toEqual({ MyBucket: { storage_gb: 500 } });
    expect('MyLambda' in result).toBe(false);
  });

  it('parses .json file using JSON.parse and returns correct UsageFile', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"MyLambda":{"requests_per_month":1000000,"avg_duration_ms":200}}');
    const jsonParseSpy = vi.spyOn(JSON, 'parse');

    const result = parseUsageFile('/some/usage.json');

    expect(jsonParseSpy).toHaveBeenCalled();
    expect(mockYamlLoad).not.toHaveBeenCalled();
    expect(result).toEqual({ MyLambda: { requests_per_month: 1000000, avg_duration_ms: 200 } });
  });

  it('treats .JSON extension as JSON (case-insensitive)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"MyBucket":{"storage_gb":100}}');
    const jsonParseSpy = vi.spyOn(JSON, 'parse');

    const result = parseUsageFile('/some/usage.JSON');

    expect(jsonParseSpy).toHaveBeenCalled();
    expect(mockYamlLoad).not.toHaveBeenCalled();
    expect(result).toEqual({ MyBucket: { storage_gb: 100 } });
  });

  it('uses js-yaml for .yaml extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('yaml content');
    mockYamlLoad.mockReturnValue({ MyBucket: { storage_gb: 200 } });

    const result = parseUsageFile('/some/usage.yaml');

    expect(mockYamlLoad).toHaveBeenCalled();
    expect(result).toEqual({ MyBucket: { storage_gb: 200 } });
  });

  it('treats .YML extension as YAML (case-insensitive)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('yaml content');
    mockYamlLoad.mockReturnValue({ MyQueue: { requests_per_month: 500 } });

    const result = parseUsageFile('/some/usage.YML');

    expect(mockYamlLoad).toHaveBeenCalled();
    expect(result).toEqual({ MyQueue: { requests_per_month: 500 } });
  });

  it('throws StackPriceError for invalid JSON content', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json {{ }}');
    vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError('Unexpected token');
    });

    expect(() => parseUsageFile('/some/usage.json')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/some/usage.json')).toThrow('Invalid JSON');
  });

  it('throws StackPriceError for .toml extension before reading file', () => {
    expect(() => parseUsageFile('/some/usage.toml')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/some/usage.toml')).toThrow('--usage-file must be');
    expect(mockExistsSync).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('throws StackPriceError for .txt extension before reading file', () => {
    expect(() => parseUsageFile('/some/usage.txt')).toThrow(StackPriceError);
    expect(() => parseUsageFile('/some/usage.txt')).toThrow('--usage-file must be');
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });
});

describe('calculateEstimatedCost', () => {
  describe('AWS::Lambda::Function', () => {
    it('calculates cost with all fields', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::Lambda::Function',
        unitPrice: 0.0000166667,
        unit: 'GB-second',
      });
      const usage = { requests_per_month: 5000000, avg_duration_ms: 200, memory_mb: 256 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('AWS::Lambda::Function');
      expect(result!.logicalId).toBe('MyResource');
      expect(result!.unitPrice).toBe(0.0000166667);
      expect(result!.unit).toBe('GB-second');
      expect(result!.currency).toBe('USD');
      // GB-seconds = (256/1024) * (200/1000) * 5000000 = 0.25 * 0.2 * 5000000 = 250000
      // cost = 250000 * 0.0000166667 ≈ 4.16667
      expect(result!.estimatedMonthlyCost).toBeCloseTo(4.16667, 2);
      expect(result!.basis).toContain('req');
      expect(result!.basis).toContain('200ms');
      expect(result!.basis).toContain('256MB');
    });

    it('defaults memory_mb to 128 when not provided', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::Lambda::Function',
        unitPrice: 0.0000166667,
        unit: 'GB-second',
      });
      const usage = { requests_per_month: 1000000, avg_duration_ms: 100 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      // GB-seconds = (128/1024) * (100/1000) * 1000000 = 0.125 * 0.1 * 1000000 = 12500
      expect(result!.estimatedMonthlyCost).toBeCloseTo(12500 * 0.0000166667, 2);
    });

    it('returns null when avg_duration_ms is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::Lambda::Function' });
      const usage = { requests_per_month: 5000000 };
      expect(calculateEstimatedCost(resource, usage)).toBeNull();
    });

    it('returns null when requests_per_month is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::Lambda::Function' });
      const usage = { avg_duration_ms: 200, memory_mb: 256 };
      expect(calculateEstimatedCost(resource, usage)).toBeNull();
    });
  });

  describe('AWS::S3::Bucket', () => {
    it('calculates cost with storage_gb', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'DataBucket',
        type: 'AWS::S3::Bucket',
        unitPrice: 0.023,
        unit: 'GB-Mo',
      });
      const usage = { storage_gb: 500 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(500 * 0.023, 5);
      expect(result!.basis).toContain('500GB');
    });

    it('returns null when storage_gb is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::S3::Bucket' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });
  });

  describe('AWS::SQS::Queue', () => {
    it('calculates cost with requests_per_month', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'JobQueue',
        type: 'AWS::SQS::Queue',
        unitPrice: 0.0000004,
        unit: 'Requests',
      });
      const usage = { requests_per_month: 10000000 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(10000000 * 0.0000004, 5);
      expect(result!.basis).toContain('requests');
    });

    it('returns null when requests_per_month is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::SQS::Queue' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });
  });

  describe('AWS::SNS::Topic', () => {
    it('calculates cost with requests_per_month', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'AlertTopic',
        type: 'AWS::SNS::Topic',
        unitPrice: 0.0000005,
        unit: 'Requests',
      });
      const usage = { requests_per_month: 1000000 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(1000000 * 0.0000005, 5);
      expect(result!.basis).toContain('notification');
    });

    it('returns null when requests_per_month is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::SNS::Topic' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });
  });

  describe('AWS::ApiGateway::RestApi', () => {
    it('calculates cost with requests_per_month', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'MyApi',
        type: 'AWS::ApiGateway::RestApi',
        unitPrice: 0.0000035,
        unit: 'Requests',
      });
      const usage = { requests_per_month: 2000000 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(2000000 * 0.0000035, 5);
      expect(result!.basis).toContain('requests');
    });

    it('returns null when requests_per_month is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::ApiGateway::RestApi' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });
  });

  describe('AWS::EC2::NatGateway', () => {
    it('calculates cost with data_transfer_gb', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'MyNatGw',
        type: 'AWS::EC2::NatGateway',
        unitPrice: 0.045,
        unit: 'GB',
      });
      const usage = { data_transfer_gb: 100 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(100 * 0.045, 5);
      expect(result!.basis).toBe('100GB processed');
      expect(result!.logicalId).toBe('MyNatGw');
      expect(result!.type).toBe('AWS::EC2::NatGateway');
    });

    it('returns null when data_transfer_gb is missing', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::EC2::NatGateway' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });

    it('returns null when data_transfer_gb is not a number', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::EC2::NatGateway' });
      expect(calculateEstimatedCost(resource, { data_transfer_gb: 'lots' as unknown as number })).toBeNull();
    });
  });

  describe('AWS::CloudFront::Distribution', () => {
    it('calculates combined cost from monthly_requests and monthly_transfer_gb', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'MyCDN',
        type: 'AWS::CloudFront::Distribution',
        unitPrice: 0.00000075,
        unit: 'Requests',
      });
      const usage = { monthly_requests: 1000000, monthly_transfer_gb: 100 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      // requests_cost = 1000000 * 0.00000075 = 0.75
      // transfer_cost = 100 * 0.085 = 8.5
      // total = 9.25
      expect(result!.estimatedMonthlyCost).toBeCloseTo(9.25, 5);
      expect(result!.logicalId).toBe('MyCDN');
      expect(result!.type).toBe('AWS::CloudFront::Distribution');
      expect(result!.currency).toBe('USD');
    });

    it('basis string includes requests, GB transfer, and US zone label', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::CloudFront::Distribution',
        unitPrice: 0.00000075,
        unit: 'Requests',
      });
      const usage = { monthly_requests: 5000000, monthly_transfer_gb: 200 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.basis).toBe('5000000 requests + 200GB transfer (US zone)');
    });

    it('returns null when monthly_requests is missing', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::CloudFront::Distribution',
        unitPrice: 0.00000075,
        unit: 'Requests',
      });
      expect(calculateEstimatedCost(resource, { monthly_transfer_gb: 100 })).toBeNull();
    });

    it('returns null when monthly_transfer_gb is missing', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::CloudFront::Distribution',
        unitPrice: 0.00000075,
        unit: 'Requests',
      });
      expect(calculateEstimatedCost(resource, { monthly_requests: 1000000 })).toBeNull();
    });
  });

  describe('AWS::Logs::LogGroup', () => {
    it('calculates combined cost from ingestion_gb and storage_gb', () => {
      const resource = makeUsageBasedResource({
        logicalId: 'AppLogGroup',
        type: 'AWS::Logs::LogGroup',
        unitPrice: 0.50,
        unit: 'GB',
      });
      const usage = { ingestion_gb: 10, storage_gb: 50 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      // ingestion_cost = 10 * 0.50 = 5.00
      // storage_cost   = 50 * 0.03 = 1.50
      // total = 6.50
      expect(result!.estimatedMonthlyCost).toBeCloseTo(6.50, 5);
      expect(result!.logicalId).toBe('AppLogGroup');
      expect(result!.type).toBe('AWS::Logs::LogGroup');
      expect(result!.currency).toBe('USD');
    });

    it('calculates ingestion-only cost when storage_gb is absent', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::Logs::LogGroup',
        unitPrice: 0.50,
        unit: 'GB',
      });
      const usage = { ingestion_gb: 10 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.estimatedMonthlyCost).toBeCloseTo(5.00, 5);
      expect(result!.basis).toBe('10GB ingested');
    });

    it('calculates storage-only cost when ingestion_gb is absent', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::Logs::LogGroup',
        unitPrice: 0.50,
        unit: 'GB',
      });
      const usage = { storage_gb: 100 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      // ingestion_cost = 0 * 0.50 = 0.00
      // storage_cost   = 100 * 0.03 = 3.00
      expect(result!.estimatedMonthlyCost).toBeCloseTo(3.00, 5);
      expect(result!.basis).toBe('100GB stored');
    });

    it('returns null when both ingestion_gb and storage_gb are absent', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::Logs::LogGroup' });
      expect(calculateEstimatedCost(resource, {})).toBeNull();
    });

    it('returns null when both ingestion_gb and storage_gb are zero', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::Logs::LogGroup' });
      expect(calculateEstimatedCost(resource, { ingestion_gb: 0, storage_gb: 0 })).toBeNull();
    });

    it('basis includes both components when both are non-zero', () => {
      const resource = makeUsageBasedResource({
        type: 'AWS::Logs::LogGroup',
        unitPrice: 0.50,
        unit: 'GB',
      });
      const usage = { ingestion_gb: 10, storage_gb: 50 };
      const result = calculateEstimatedCost(resource, usage);

      expect(result).not.toBeNull();
      expect(result!.basis).toBe('10GB ingested + 50GB stored');
    });
  });

  describe('unknown resource type', () => {
    it('returns null for an unrecognised type', () => {
      const resource = makeUsageBasedResource({ type: 'AWS::Unknown::Resource' });
      const usage = { requests_per_month: 1000000 };
      expect(calculateEstimatedCost(resource, usage)).toBeNull();
    });
  });

  describe('catch-all safety net', () => {
    it('returns null when resource is null/undefined (runtime type violation)', () => {
      // Test the catch block — never throws, always returns null
      const result = calculateEstimatedCost(
        null as unknown as ReturnType<typeof makeUsageBasedResource>,
        {},
      );
      expect(result).toBeNull();
    });
  });
});
