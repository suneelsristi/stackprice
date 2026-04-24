import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── fs mock ──────────────────────────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]): unknown => mockExistsSync(...args),
    writeFileSync: (...args: unknown[]): unknown => mockWriteFileSync(...args),
    readFileSync: (...args: unknown[]): unknown => mockReadFileSync(...args),
  };
});

// ─── readAssembly mock ────────────────────────────────────────────────────────

const mockReadAssembly = vi.fn();

vi.mock('../../../src/assembly/reader.js', () => ({
  readAssembly: (...args: unknown[]): unknown => mockReadAssembly(...args),
}));

import {
  discoverUsageResources,
  generateYaml,
  generateJson,
  writeGeneratedFile,
} from '../../../src/generate/usage-file-generator.js';
import type { UsageResource, GenerateOptions } from '../../../src/generate/usage-file-generator.js';
import { StackPriceError } from '../../../src/errors/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAssembly(stacks: Array<{ id: string; templateFile: string }>): {
  version: string;
  stacks: Array<{ id: string; templateFile: string; environment: { account: string; region: string } }>;
} {
  return {
    version: '17.0.0',
    stacks: stacks.map((s) => ({
      id: s.id,
      templateFile: s.templateFile,
      environment: { account: '123456789012', region: 'us-east-1' },
    })),
  };
}

function makeTemplate(resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>): string {
  return JSON.stringify({ Resources: resources });
}

function makeGenerateOptions(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    dir: './cdk.out',
    format: 'yaml',
    outFile: 'stackprice-usage.yml',
    force: false,
    types: [],
    ...overrides,
  };
}

function makeLambdaResource(logicalId: string, props: Record<string, unknown> = {}): UsageResource {
  return {
    logicalId,
    type: 'AWS::Lambda::Function',
    stackId: 'MyStack',
    properties: { Runtime: 'nodejs20.x', MemorySize: 128, Timeout: 3, ...props },
  };
}

function makeS3Resource(logicalId: string, props: Record<string, unknown> = {}): UsageResource {
  return {
    logicalId,
    type: 'AWS::S3::Bucket',
    stackId: 'MyStack',
    properties: { ...props },
  };
}

function makeSqsResource(logicalId: string, props: Record<string, unknown> = {}): UsageResource {
  return {
    logicalId,
    type: 'AWS::SQS::Queue',
    stackId: 'MyStack',
    properties: { ...props },
  };
}

function makeSnsResource(logicalId: string, props: Record<string, unknown> = {}): UsageResource {
  return {
    logicalId,
    type: 'AWS::SNS::Topic',
    stackId: 'MyStack',
    properties: { ...props },
  };
}

function makeApiGatewayResource(logicalId: string, props: Record<string, unknown> = {}): UsageResource {
  return {
    logicalId,
    type: 'AWS::ApiGateway::RestApi',
    stackId: 'MyStack',
    properties: { ...props },
  };
}

function makeNatGatewayResource(logicalId: string): UsageResource {
  return {
    logicalId,
    type: 'AWS::EC2::NatGateway',
    stackId: 'MyStack',
    properties: {},
  };
}

function makeCloudFrontResource(logicalId: string): UsageResource {
  return {
    logicalId,
    type: 'AWS::CloudFront::Distribution',
    stackId: 'MyStack',
    properties: {},
  };
}

// ─── discoverUsageResources ───────────────────────────────────────────────────

describe('discoverUsageResources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Lambda, S3, SQS, SNS, ApiGateway resources from a template', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyLambda: { Type: 'AWS::Lambda::Function', Properties: { Runtime: 'nodejs20.x', MemorySize: 256 } },
      MyBucket: { Type: 'AWS::S3::Bucket' },
      MyQueue:  { Type: 'AWS::SQS::Queue' },
      MyTopic:  { Type: 'AWS::SNS::Topic' },
      MyApi:    { Type: 'AWS::ApiGateway::RestApi' },
      MyEC2:    { Type: 'AWS::EC2::Instance' },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(5);
    const types = resources.map((r) => r.type);
    expect(types).toContain('AWS::Lambda::Function');
    expect(types).toContain('AWS::S3::Bucket');
    expect(types).toContain('AWS::SQS::Queue');
    expect(types).toContain('AWS::SNS::Topic');
    expect(types).toContain('AWS::ApiGateway::RestApi');
    expect(types).not.toContain('AWS::EC2::Instance');
  });

  it('returns NatGateway and CloudFront resources when present', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyNat:    { Type: 'AWS::EC2::NatGateway' },
      MyCF:     { Type: 'AWS::CloudFront::Distribution' },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(2);
    expect(resources.map((r) => r.type)).toContain('AWS::EC2::NatGateway');
    expect(resources.map((r) => r.type)).toContain('AWS::CloudFront::Distribution');
  });

  it('filters by stack name correctly', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([
      { id: 'StackA', templateFile: 'StackA.template.json' },
      { id: 'StackB', templateFile: 'StackB.template.json' },
    ]));
    mockReadFileSync
      .mockReturnValueOnce(makeTemplate({ LambdaA: { Type: 'AWS::Lambda::Function' } }))
      .mockReturnValueOnce(makeTemplate({ LambdaB: { Type: 'AWS::Lambda::Function' } }));

    const resources = discoverUsageResources('./cdk.out', 'StackA');

    expect(resources).toHaveLength(1);
    expect(resources[0]!.stackId).toBe('StackA');
    expect(resources[0]!.logicalId).toBe('LambdaA');
  });

  it('filters by type short name correctly', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyLambda: { Type: 'AWS::Lambda::Function' },
      MyBucket: { Type: 'AWS::S3::Bucket' },
    }));

    const resources = discoverUsageResources('./cdk.out', undefined, ['Lambda']);

    expect(resources).toHaveLength(1);
    expect(resources[0]!.type).toBe('AWS::Lambda::Function');
  });

  it('returns empty array when no usage-based resources found', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyEC2: { Type: 'AWS::EC2::Instance' },
      MyRDS: { Type: 'AWS::RDS::DBInstance' },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(0);
  });

  it('throws StackPriceError for missing directory', () => {
    mockReadAssembly.mockImplementation(() => {
      throw new StackPriceError('Directory not found: /missing', 2);
    });

    expect(() => discoverUsageResources('/missing')).toThrow(StackPriceError);
  });

  it('throws StackPriceError for invalid CDK assembly', () => {
    mockReadAssembly.mockImplementation(() => {
      throw new StackPriceError('Not a valid CDK cloud assembly', 2);
    });

    expect(() => discoverUsageResources('./not-a-cdk-out')).toThrow(StackPriceError);
  });

  it('throws StackPriceError for unknown stack name', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'ExistingStack', templateFile: 'ExistingStack.template.json' }]));

    expect(() => discoverUsageResources('./cdk.out', 'NonExistentStack')).toThrow(StackPriceError);
    expect(() => discoverUsageResources('./cdk.out', 'NonExistentStack')).toThrowError(/NonExistentStack/);
  });

  it('throws StackPriceError when template file cannot be read', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });

    expect(() => discoverUsageResources('./cdk.out')).toThrow(StackPriceError);
  });

  it('handles resources with no Properties block gracefully', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(JSON.stringify({
      Resources: {
        BareFunc: { Type: 'AWS::Lambda::Function' },
      },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(1);
    expect(resources[0]!.logicalId).toBe('BareFunc');
    expect(resources[0]!.properties).toEqual({});
  });

  it('returns empty array for template with no Resources block', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(JSON.stringify({ AWSTemplateFormatVersion: '2010-09-09' }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(0);
  });

  it('excludes CDK internal Lambda (Handler: __entrypoint__.handler) from discovery', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      CustomVpcRestrictDefaultSGCustomResourceProviderHandlerDC833E5E: {
        Type: 'AWS::Lambda::Function',
        Properties: { Handler: '__entrypoint__.handler', Runtime: 'nodejs20.x' },
      },
      MyUserLambda: {
        Type: 'AWS::Lambda::Function',
        Properties: { Handler: 'index.handler', Runtime: 'nodejs20.x' },
      },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(1);
    expect(resources[0]!.logicalId).toBe('MyUserLambda');
  });

  it('includes regular Lambda (non-CDK-internal) in discovery', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyFunc: {
        Type: 'AWS::Lambda::Function',
        Properties: { Handler: 'dist/handler.main', Runtime: 'nodejs20.x' },
      },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(1);
    expect(resources[0]!.logicalId).toBe('MyFunc');
  });

  it('CDK internal Lambda filter does not affect other resource types', () => {
    mockReadAssembly.mockReturnValue(makeAssembly([{ id: 'MyStack', templateFile: 'MyStack.template.json' }]));
    mockReadFileSync.mockReturnValue(makeTemplate({
      MyBucket: { Type: 'AWS::S3::Bucket', Properties: { Handler: '__entrypoint__.handler' } },
      MyQueue: { Type: 'AWS::SQS::Queue', Properties: { Handler: '__entrypoint__.handler' } },
    }));

    const resources = discoverUsageResources('./cdk.out');

    expect(resources).toHaveLength(2);
    const types = resources.map((r) => r.type);
    expect(types).toContain('AWS::S3::Bucket');
    expect(types).toContain('AWS::SQS::Queue');
  });
});

// ─── generateYaml ─────────────────────────────────────────────────────────────

describe('generateYaml', () => {
  it('Lambda: pre-filled memory_mb from template', () => {
    const resources = [makeLambdaResource('MyFunc', { MemorySize: 512 })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('memory_mb: 512');
  });

  it('Lambda: default memory_mb 128 when MemorySize absent', () => {
    const resources = [makeLambdaResource('MyFunc', { MemorySize: undefined })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('memory_mb: 128');
  });

  it('Lambda: timeout hint in comment (seconds to ms)', () => {
    const resources = [makeLambdaResource('MyFunc', { Timeout: 30 })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('max: 30000ms');
  });

  it('Lambda: runtime in comment', () => {
    const resources = [makeLambdaResource('MyFunc', { Runtime: 'python3.12' })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('Runtime: python3.12');
  });

  it('Lambda: FunctionName used as label if present', () => {
    const resources = [makeLambdaResource('MyFunc', { FunctionName: 'my-api-handler' })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('Name: my-api-handler');
  });

  it('S3: storage_gb: 0 with comment', () => {
    const resources = [makeS3Resource('MyBucket')];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('storage_gb: 0');
    expect(yaml).toContain('# TODO: average GB stored per month');
  });

  it('S3: BucketName added as label comment if present', () => {
    const resources = [makeS3Resource('MyBucket', { BucketName: 'my-data-bucket' })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# Name: my-data-bucket');
  });

  it('SQS: Standard queue type comment', () => {
    const resources = [makeSqsResource('MyQueue')];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# Queue type: Standard');
  });

  it('SQS: FIFO queue type comment when FifoQueue=true', () => {
    const resources = [makeSqsResource('MyFifoQueue', { FifoQueue: true })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# Queue type: FIFO');
  });

  it('ApiGateway: Name in comment if present', () => {
    const resources = [makeApiGatewayResource('MyApi', { Name: 'MyService' })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# Name: MyService');
  });

  it('NatGateway: fixed cost note in comment', () => {
    const resources = [makeNatGatewayResource('NatGW')];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('$32.85/month');
    expect(yaml).toContain('data_transfer_gb: 0');
  });

  it('CloudFront: geographic zone note in comment', () => {
    const resources = [makeCloudFrontResource('MyCF')];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('US edge locations');
    expect(yaml).toContain('monthly_requests: 0');
    expect(yaml).toContain('monthly_transfer_gb: 0');
  });

  it('Resources grouped by type with separator comments', () => {
    const resources = [
      makeS3Resource('BucketA'),
      makeLambdaResource('FuncA'),
    ];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# ── AWS::Lambda::Function');
    expect(yaml).toContain('# ── AWS::S3::Bucket');
  });

  it('Within each group sorted alphabetically by logicalId', () => {
    const resources = [
      makeLambdaResource('ZFunc'),
      makeLambdaResource('AFunc'),
      makeLambdaResource('MFunc'),
    ];
    const yaml = generateYaml(resources, makeGenerateOptions());

    const aPos = yaml.indexOf('AFunc:');
    const mPos = yaml.indexOf('MFunc:');
    const zPos = yaml.indexOf('ZFunc:');
    expect(aPos).toBeLessThan(mPos);
    expect(mPos).toBeLessThan(zPos);
  });

  it('Header comment contains dir and outFile path', () => {
    const resources = [makeLambdaResource('MyFunc')];
    const yaml = generateYaml(resources, makeGenerateOptions({ dir: './my-cdk', outFile: 'my-usage.yml' }));

    expect(yaml).toContain('./my-cdk');
    expect(yaml).toContain('my-usage.yml');
  });

  it('SNS: requests_per_month: 0 with comment', () => {
    const resources = [makeSnsResource('MyTopic')];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# ── AWS::SNS::Topic');
    expect(yaml).toContain('MyTopic:');
    expect(yaml).toContain('requests_per_month: 0');
    expect(yaml).toContain('# TODO: monthly notifications');
  });

  it('SNS: TopicName added as label comment if present', () => {
    const resources = [makeSnsResource('MyTopic', { TopicName: 'alerts' })];
    const yaml = generateYaml(resources, makeGenerateOptions());

    expect(yaml).toContain('# Name: alerts');
  });

  it('No resources: only header comment returned', () => {
    const yaml = generateYaml([], makeGenerateOptions());

    expect(yaml).toContain('# stackprice usage estimates');
    expect(yaml).not.toContain('AWS::Lambda::Function');
    expect(yaml).not.toContain('requests_per_month');
  });
});

// ─── generateJson ─────────────────────────────────────────────────────────────

describe('generateJson', () => {
  it('Lambda: _type, _runtime, _timeout_ms, memory_mb present', () => {
    const resources = [makeLambdaResource('MyFunc', { Runtime: 'nodejs20.x', Timeout: 30, MemorySize: 512 })];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyFunc'] as Record<string, unknown>;
    expect(entry['_type']).toBe('AWS::Lambda::Function');
    expect(entry['_runtime']).toBe('nodejs20.x');
    expect(entry['_timeout_ms']).toBe(30000);
    expect(entry['memory_mb']).toBe(512);
    expect(entry['requests_per_month']).toBe(0);
    expect(entry['avg_duration_ms']).toBe(0);
  });

  it('SQS: _queue_type present', () => {
    const resources = [makeSqsResource('MyQueue', { FifoQueue: true })];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyQueue'] as Record<string, unknown>;
    expect(entry['_queue_type']).toBe('FIFO');
    expect(entry['requests_per_month']).toBe(0);
  });

  it('SQS: Standard _queue_type when FifoQueue absent', () => {
    const resources = [makeSqsResource('MyQueue')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyQueue'] as Record<string, unknown>;
    expect(entry['_queue_type']).toBe('Standard');
  });

  it('NatGateway: _note about fixed cost present', () => {
    const resources = [makeNatGatewayResource('NatGW')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['NatGW'] as Record<string, unknown>;
    expect(entry['_note']).toContain('$32.85/month');
    expect(entry['data_transfer_gb']).toBe(0);
  });

  it('CloudFront: _note about geographic zone present', () => {
    const resources = [makeCloudFrontResource('MyCF')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyCF'] as Record<string, unknown>;
    expect(entry['_note']).toContain('geographic zone');
    expect(entry['monthly_requests']).toBe(0);
    expect(entry['monthly_transfer_gb']).toBe(0);
  });

  it('_ prefixed metadata keys present at top level', () => {
    const resources = [makeS3Resource('MyBucket')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    expect(json['_generated']).toBe('stackprice generate usage-file');
    expect(json['_source']).toBeDefined();
    expect(json['_instructions']).toBeDefined();
  });

  it('No resources: object with only metadata keys', () => {
    const json = JSON.parse(generateJson([], makeGenerateOptions())) as Record<string, unknown>;

    const keys = Object.keys(json);
    expect(keys.every((k) => k.startsWith('_'))).toBe(true);
    expect(keys).toContain('_generated');
    expect(keys).toContain('_source');
    expect(keys).toContain('_instructions');
  });

  it('SNS: _type and requests_per_month present', () => {
    const resources = [makeSnsResource('MyTopic')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyTopic'] as Record<string, unknown>;
    expect(entry['_type']).toBe('AWS::SNS::Topic');
    expect(entry['requests_per_month']).toBe(0);
  });

  it('ApiGateway: _name present when Name property set', () => {
    const resources = [makeApiGatewayResource('MyApi', { Name: 'MyService' })];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyApi'] as Record<string, unknown>;
    expect(entry['_type']).toBe('AWS::ApiGateway::RestApi');
    expect(entry['_name']).toBe('MyService');
    expect(entry['requests_per_month']).toBe(0);
  });

  it('ApiGateway: no _name when Name property absent', () => {
    const resources = [makeApiGatewayResource('MyApi')];
    const json = JSON.parse(generateJson(resources, makeGenerateOptions())) as Record<string, unknown>;

    const entry = json['MyApi'] as Record<string, unknown>;
    expect(entry['_name']).toBeUndefined();
    expect(entry['requests_per_month']).toBe(0);
  });
});

// ─── writeGeneratedFile ───────────────────────────────────────────────────────

describe('writeGeneratedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes content to the correct path', () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockReturnValue(undefined);

    writeGeneratedFile('hello', 'stackprice-usage.yml', false);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [calledPath, calledContent] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(calledPath).toContain('stackprice-usage.yml');
    expect(calledContent).toBe('hello');
  });

  it('throws StackPriceError if file exists and force=false', () => {
    mockExistsSync.mockReturnValue(true);

    expect(() => writeGeneratedFile('hello', 'stackprice-usage.yml', false)).toThrow(StackPriceError);
    expect(() => writeGeneratedFile('hello', 'stackprice-usage.yml', false)).toThrowError(
      /already exists/,
    );
  });

  it('overwrites file if force=true', () => {
    mockExistsSync.mockReturnValue(true);
    mockWriteFileSync.mockReturnValue(undefined);

    expect(() => writeGeneratedFile('hello', 'stackprice-usage.yml', true)).not.toThrow();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('throws StackPriceError if writeFileSync throws', () => {
    mockExistsSync.mockReturnValue(false);
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => writeGeneratedFile('hello', 'stackprice-usage.yml', false)).toThrow(StackPriceError);
  });
});
