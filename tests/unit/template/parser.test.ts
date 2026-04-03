import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseStacks } from '../../../src/template/parser.js';
import { StackPriceError } from '../../../src/errors/index.js';
import type { CloudAssembly } from '../../../src/assembly/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal valid CloudFormation template with several resource types. */
const MULTI_RESOURCE_TEMPLATE = {
  AWSTemplateFormatVersion: '2010-09-09',
  Resources: {
    WebServer: {
      Type: 'AWS::EC2::Instance',
      Properties: { InstanceType: 'm5.large', ImageId: 'ami-12345678' },
    },
    Database: {
      Type: 'AWS::RDS::DBInstance',
      Properties: {
        DBInstanceClass: 'db.t3.micro',
        Engine: 'mysql',
        MasterUsername: 'admin',
        MasterUserPassword: 'password',
      },
    },
    DataBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: { BucketName: 'my-data-bucket' },
    },
  },
};

/** Template where one resource is gated by a CloudFormation Condition. */
const TEMPLATE_WITH_CONDITIONAL = {
  AWSTemplateFormatVersion: '2010-09-09',
  Conditions: {
    IsProd: { 'Fn::Equals': [{ Ref: 'Env' }, 'prod'] },
  },
  Parameters: {
    Env: { Type: 'String', Default: 'dev' },
  },
  Resources: {
    AlwaysPresent: {
      Type: 'AWS::EC2::Instance',
      Properties: { InstanceType: 't3.micro', ImageId: 'ami-abc' },
    },
    ProdOnlyCache: {
      Type: 'AWS::ElastiCache::CacheCluster',
      Condition: 'IsProd',
      Properties: { CacheNodeType: 'cache.t3.micro', NumCacheNodes: 1 },
    },
    AnotherConditional: {
      Type: 'AWS::RDS::DBInstance',
      Condition: 'IsProd',
      Properties: { DBInstanceClass: 'db.r5.large', Engine: 'postgres' },
    },
  },
};

/** Template containing a resource type the pricing engine won't recognise. */
const TEMPLATE_WITH_UNKNOWN_TYPE = {
  AWSTemplateFormatVersion: '2010-09-09',
  Resources: {
    KnownResource: {
      Type: 'AWS::EC2::Instance',
      Properties: { InstanceType: 't3.small', ImageId: 'ami-xyz' },
    },
    UnknownWidget: {
      Type: 'AWS::Custom::Widget',
      Properties: { WidgetColor: 'blue' },
    },
    IamRole: {
      Type: 'AWS::IAM::Role',
      Properties: { AssumeRolePolicyDocument: {} },
    },
  },
};

/** Template with no Resources block at all. */
const TEMPLATE_NO_RESOURCES = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'A template that has no resources.',
};

/** Template with parameters that Ref intrinsics can resolve. */
const TEMPLATE_WITH_REF_PARAMS = {
  AWSTemplateFormatVersion: '2010-09-09',
  Parameters: {
    InstanceType: { Type: 'String', Default: 'm5.xlarge' },
    NoDefaultParam: { Type: 'String' },
  },
  Resources: {
    Server: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: { Ref: 'InstanceType' },
        ImageId: { Ref: 'NoDefaultParam' },
        ExtraTag: { 'Fn::Sub': 'server-${InstanceType}' },
      },
    },
  },
};

/** Template where a resource has an Fn::If property. */
const TEMPLATE_WITH_FN_IF = {
  AWSTemplateFormatVersion: '2010-09-09',
  Conditions: { IsProd: { 'Fn::Equals': ['prod', 'prod'] } },
  Resources: {
    Instance: {
      Type: 'AWS::EC2::Instance',
      Properties: {
        InstanceType: { 'Fn::If': ['IsProd', 'm5.large', 't3.micro'] },
        ImageId: 'ami-fixed',
      },
    },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackprice-parser-test-'));
  tempDirs.push(dir);
  return dir;
}

function writeTemplate(dir: string, filename: string, content: unknown): void {
  const raw = typeof content === 'string' ? content : JSON.stringify(content);
  fs.writeFileSync(path.join(dir, filename), raw, 'utf-8');
}

function makeAssembly(
  dir: string,
  stacks: Array<{ id: string; templateFile: string; region?: string }>,
): CloudAssembly {
  return {
    version: '36.0.0',
    stacks: stacks.map(({ id, templateFile, region }) => ({
      id,
      templateFile,
      environment: {
        account: '123456789012',
        region: region ?? 'us-east-1',
      },
    })),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ─── parseStacks ──────────────────────────────────────────────────────────────

describe('parseStacks', () => {
  // ── Happy path — valid template with multiple resource types ───────────────

  describe('happy path — valid template with multiple resource types', () => {
    it('returns one ParsedStack per stack in the assembly', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const result = parseStacks(assembly, dir);
      expect(result).toHaveLength(1);
    });

    it('sets stackId from the manifest artifact key', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.stackId).toBe('MyStack');
    });

    it('extracts all resources into the resources array', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(3);
    });

    it('sets the logicalId on each resource record', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const ids = stack?.resources.map((r) => r.logicalId) ?? [];
      expect(ids).toContain('WebServer');
      expect(ids).toContain('Database');
      expect(ids).toContain('DataBucket');
    });

    it('sets the type on each resource record', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const types = stack?.resources.map((r) => r.type) ?? [];
      expect(types).toContain('AWS::EC2::Instance');
      expect(types).toContain('AWS::RDS::DBInstance');
      expect(types).toContain('AWS::S3::Bucket');
    });

    it('copies resource properties onto the record', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const webServer = stack?.resources.find(
        (r) => r.logicalId === 'WebServer',
      );
      expect(webServer?.properties['InstanceType']).toBe('m5.large');
    });

    it('sets region and regionSource from the assembly environment', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      // makeAssembly defaults to environment.region = 'us-east-1'.
      // resolveRegion('us-east-1') → source: 'template' (real region, not unknown-region).
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.region).toBe('us-east-1');
      expect(stack?.regionSource).toBe('template');
    });

    it('returns an empty unsupportedTypes array (populated later by engine)', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'MyStack.template.json', MULTI_RESOURCE_TEMPLATE);
      const assembly = makeAssembly(dir, [
        { id: 'MyStack', templateFile: 'MyStack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.unsupportedTypes).toEqual([]);
    });

    it('handles an assembly with multiple stacks', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'StackA.template.json', MULTI_RESOURCE_TEMPLATE);
      writeTemplate(dir, 'StackB.template.json', TEMPLATE_NO_RESOURCES);
      const assembly = makeAssembly(dir, [
        { id: 'StackA', templateFile: 'StackA.template.json' },
        { id: 'StackB', templateFile: 'StackB.template.json' },
      ]);

      const result = parseStacks(assembly, dir);
      expect(result).toHaveLength(2);
      const ids = result.map((s) => s.stackId);
      expect(ids).toContain('StackA');
      expect(ids).toContain('StackB');
    });

    it('returns an empty array when the assembly has no stacks', () => {
      const dir = makeTempDir();
      const assembly: CloudAssembly = { version: '36.0.0', stacks: [] };
      const result = parseStacks(assembly, dir);
      expect(result).toHaveLength(0);
    });
  });

  // ── Conditioned resources — ADR-011 ───────────────────────────────────────

  describe('conditioned resources — ADR-011', () => {
    it('separates conditional resources from unconditional ones', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_CONDITIONAL);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(1);
      expect(stack?.conditionalResources).toHaveLength(2);
    });

    it('puts unconditional resources in the resources array', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_CONDITIONAL);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources[0]?.logicalId).toBe('AlwaysPresent');
    });

    it('puts conditional resources in the conditionalResources array', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_CONDITIONAL);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const condIds = stack?.conditionalResources.map((r) => r.logicalId) ?? [];
      expect(condIds).toContain('ProdOnlyCache');
      expect(condIds).toContain('AnotherConditional');
    });

    it('records the condition name on each ConditionalResourceRecord', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_CONDITIONAL);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      for (const r of stack?.conditionalResources ?? []) {
        expect(r.conditionName).toBe('IsProd');
      }
    });

    it('conditional resources still carry their type and properties', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_CONDITIONAL);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const cache = stack?.conditionalResources.find(
        (r) => r.logicalId === 'ProdOnlyCache',
      );
      expect(cache?.type).toBe('AWS::ElastiCache::CacheCluster');
      expect(cache?.properties['CacheNodeType']).toBe('cache.t3.micro');
    });
  });

  // ── Unsupported (unknown) resource types ──────────────────────────────────

  describe('unknown resource types — no crash', () => {
    it('does not crash when a template contains unknown resource types', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_UNKNOWN_TYPE);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).not.toThrow();
    });

    it('includes unknown types in the resources array alongside known types', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_UNKNOWN_TYPE);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(3);
    });

    it('records the type string for unknown resource types', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_UNKNOWN_TYPE);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const types = stack?.resources.map((r) => r.type) ?? [];
      expect(types).toContain('AWS::Custom::Widget');
      expect(types).toContain('AWS::IAM::Role');
    });

    it('leaves unsupportedTypes as empty (pricing engine populates it later)', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_UNKNOWN_TYPE);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.unsupportedTypes).toEqual([]);
    });

    it('skips resource entries that have no Type string without crashing', () => {
      const template = {
        Resources: {
          ValidResource: {
            Type: 'AWS::EC2::Instance',
            Properties: { InstanceType: 't3.micro', ImageId: 'ami-abc' },
          },
          NoTypeResource: {
            Properties: { Something: 'value' },
            // no Type field
          },
          NullResource: null,
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      // Only the valid resource is returned; the malformed ones are silently skipped.
      expect(stack?.resources).toHaveLength(1);
      expect(stack?.resources[0]?.logicalId).toBe('ValidResource');
    });
  });

  // ── Malformed template JSON — Security Rule 2 ──────────────────────────────

  describe('malformed template JSON — Security Rule 2', () => {
    it('throws StackPriceError when the template file is not valid JSON', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', 'this is {{{ not valid json');
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).toThrow(StackPriceError);
    });

    it('uses FAILURE (exit code 2) for malformed template JSON', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', '{ broken json');
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      let caught: unknown;
      try {
        parseStacks(assembly, dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(StackPriceError);
      expect((caught as StackPriceError).exitCode).toBe(2);
    });

    it('includes the template filename in the malformed-JSON error message', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'BadStack.template.json', 'not json');
      const assembly = makeAssembly(dir, [
        { id: 'BadStack', templateFile: 'BadStack.template.json' },
      ]);

      let caught: unknown;
      try {
        parseStacks(assembly, dir);
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).message).toContain(
        'BadStack.template.json',
      );
    });

    it('throws when the template JSON is a top-level array (not an object)', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', '[]');
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).toThrow(StackPriceError);
    });

    it('throws when the template file does not exist', () => {
      const dir = makeTempDir();
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'NonExistent.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).toThrow(StackPriceError);
    });

    it('throws StackPriceError when the template file exists but cannot be read', () => {
      const dir = makeTempDir();
      const templatePath = path.join(dir, 'Unreadable.template.json');
      writeTemplate(dir, 'Unreadable.template.json', '{}');
      fs.chmodSync(templatePath, 0o000);

      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Unreadable.template.json' },
      ]);

      let caught: unknown;
      try {
        parseStacks(assembly, dir);
      } catch (err) {
        caught = err;
      } finally {
        // Restore permissions so afterEach cleanup can delete the file.
        try { fs.chmodSync(templatePath, 0o644); } catch { /* best-effort */ }
      }

      // Skip assertion when running as root (root can read any file).
      if (process.getuid !== undefined && process.getuid() === 0) return;

      expect(caught).toBeInstanceOf(StackPriceError);
      expect((caught as StackPriceError).exitCode).toBe(2);
    });
  });

  // ── Missing Resources block ───────────────────────────────────────────────

  describe('missing Resources block — handled gracefully', () => {
    it('does not throw when the template has no Resources key', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_NO_RESOURCES);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).not.toThrow();
    });

    it('returns empty resource arrays when Resources is absent', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', TEMPLATE_NO_RESOURCES);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(0);
      expect(stack?.conditionalResources).toHaveLength(0);
    });

    it('still returns the correct stackId when Resources is absent', () => {
      const dir = makeTempDir();
      writeTemplate(dir, 'Empty.template.json', TEMPLATE_NO_RESOURCES);
      const assembly = makeAssembly(dir, [
        { id: 'EmptyStack', templateFile: 'Empty.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.stackId).toBe('EmptyStack');
    });

    it('handles Resources being null gracefully', () => {
      const template = { Resources: null };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      expect(() => parseStacks(assembly, dir)).not.toThrow();
      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(0);
    });

    it('handles Resources being an empty object gracefully', () => {
      const template = { Resources: {} };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(0);
    });
  });

  // ── Intrinsic function resolution ─────────────────────────────────────────

  describe('intrinsic function resolution', () => {
    describe('Ref — parameter defaults', () => {
      it('resolves Ref to a parameter default value', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_REF_PARAMS);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const server = stack?.resources.find((r) => r.logicalId === 'Server');
        // InstanceType has Default: 'm5.xlarge'
        expect(server?.properties['InstanceType']).toBe('m5.xlarge');
      });

      it('resolves Ref to null when the parameter has no default', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_REF_PARAMS);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const server = stack?.resources.find((r) => r.logicalId === 'Server');
        // ImageId Ref: 'NoDefaultParam' — no Default defined
        expect(server?.properties['ImageId']).toBeNull();
      });

      it('resolves Fn::Sub with a parameter default', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_REF_PARAMS);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const server = stack?.resources.find((r) => r.logicalId === 'Server');
        // Fn::Sub: 'server-${InstanceType}' — InstanceType default is 'm5.xlarge'
        expect(server?.properties['ExtraTag']).toBe('server-m5.xlarge');
      });

      it('resolves Ref for AWS pseudo-parameters to null', () => {
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: { Ref: 'AWS::Region' },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBeNull();
      });
    });

    describe('Fn::If — runtime condition, returns null', () => {
      it('resolves Fn::If to null (conditions are not evaluable statically)', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_FN_IF);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const instance = stack?.resources.find(
          (r) => r.logicalId === 'Instance',
        );
        expect(instance?.properties['InstanceType']).toBeNull();
      });

      it('still parses the resource even when Fn::If cannot be resolved', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_FN_IF);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        expect(stack?.resources).toHaveLength(1);
      });

      it('leaves literal properties intact alongside Fn::If properties', () => {
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', TEMPLATE_WITH_FN_IF);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const instance = stack?.resources.find(
          (r) => r.logicalId === 'Instance',
        );
        // ImageId is a literal string — must be preserved.
        expect(instance?.properties['ImageId']).toBe('ami-fixed');
      });
    });

    describe('Fn::Sub — array form', () => {
      it('resolves Fn::Sub array form with explicit vars map', () => {
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: {
                  'Fn::Sub': ['my-bucket-${Suffix}', { Suffix: 'prod' }],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBe('my-bucket-prod');
      });

      it('resolves Fn::Sub array form where vars value is itself a resolvable intrinsic', () => {
        const template = {
          Parameters: {
            Suffix: { Type: 'String', Default: 'blue' },
          },
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: {
                  'Fn::Sub': [
                    'bucket-${Tag}',
                    { Tag: { Ref: 'Suffix' } },
                  ],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBe('bucket-blue');
      });

      it('returns null for Fn::Sub with empty array (invalid form)', () => {
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: { 'Fn::Sub': [] },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBeNull();
      });

      it('leaves token as-is when vars entry resolves to null', () => {
        // Fn::If resolves to null; the token should be left unreplaced.
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: {
                  'Fn::Sub': [
                    'bucket-${Tag}',
                    { Tag: { 'Fn::If': ['IsProd', 'prod', 'dev'] } },
                  ],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        // Fn::If resolves to null; the token ${Tag} is left as-is.
        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBe('bucket-${Tag}');
      });

      it('returns null when the template element in array form is not a string', () => {
        // operand[0] is a number, not a string — typeof template !== 'string'
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: { 'Fn::Sub': [42, {}] },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBeNull();
      });

      it('handles Fn::Sub array form when vars is not a plain object', () => {
        const template = {
          Resources: {
            Bucket: {
              Type: 'AWS::S3::Bucket',
              Properties: {
                BucketName: { 'Fn::Sub': ['bucket-${X}', null] },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        // vars falls back to empty — ${X} is left unresolved in the string
        const [stack] = parseStacks(assembly, dir);
        const bucket = stack?.resources.find((r) => r.logicalId === 'Bucket');
        expect(bucket?.properties['BucketName']).toBe('bucket-${X}');
      });
    });

    describe('Fn::Select', () => {
      it('resolves Fn::Select to the item at the given index', () => {
        const template = {
          Resources: {
            Queue: {
              Type: 'AWS::SQS::Queue',
              Properties: {
                QueueName: {
                  'Fn::Select': [1, ['queue-a', 'queue-b', 'queue-c']],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
        expect(queue?.properties['QueueName']).toBe('queue-b');
      });

      it('returns null for Fn::Select with an out-of-bounds index', () => {
        const template = {
          Resources: {
            Queue: {
              Type: 'AWS::SQS::Queue',
              Properties: {
                QueueName: {
                  'Fn::Select': [5, ['a', 'b']],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
        expect(queue?.properties['QueueName']).toBeNull();
      });

      it('returns null for Fn::Select with a negative index', () => {
        const template = {
          Resources: {
            Queue: {
              Type: 'AWS::SQS::Queue',
              Properties: {
                QueueName: { 'Fn::Select': [-1, ['a', 'b']] },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
        expect(queue?.properties['QueueName']).toBeNull();
      });

      it('returns null for Fn::Select with a non-numeric index', () => {
        const template = {
          Resources: {
            Queue: {
              Type: 'AWS::SQS::Queue',
              Properties: {
                QueueName: {
                  'Fn::Select': [{ Ref: 'AWS::Region' }, ['a', 'b']],
                },
              },
            },
          },
        };
        const dir = makeTempDir();
        writeTemplate(dir, 'Stack.template.json', template);
        const assembly = makeAssembly(dir, [
          { id: 'Stack', templateFile: 'Stack.template.json' },
        ]);

        const [stack] = parseStacks(assembly, dir);
        const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
        expect(queue?.properties['QueueName']).toBeNull();
      });
    });
  });

  // ── Intrinsics edge cases ─────────────────────────────────────────────────

  describe('intrinsics edge cases', () => {
    it('returns null for Ref with a non-string value', () => {
      const template = {
        Resources: {
          Instance: {
            Type: 'AWS::EC2::Instance',
            Properties: {
              InstanceType: { Ref: 123 },
              ImageId: 'ami-abc',
            },
          },
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const inst = stack?.resources.find((r) => r.logicalId === 'Instance');
      expect(inst?.properties['InstanceType']).toBeNull();
    });

    it('returns null for Fn::Select with a non-array operand', () => {
      const template = {
        Resources: {
          Queue: {
            Type: 'AWS::SQS::Queue',
            Properties: {
              QueueName: { 'Fn::Select': 'not-an-array' },
            },
          },
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
      expect(queue?.properties['QueueName']).toBeNull();
    });

    it('returns null for Fn::Select with an array shorter than 2 elements', () => {
      const template = {
        Resources: {
          Queue: {
            Type: 'AWS::SQS::Queue',
            Properties: {
              QueueName: { 'Fn::Select': [0] },
            },
          },
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      const queue = stack?.resources.find((r) => r.logicalId === 'Queue');
      expect(queue?.properties['QueueName']).toBeNull();
    });

    it('skips malformed parameter entries (non-object) when building context', () => {
      // Parameter value is a string, not an object — should be ignored gracefully.
      const template = {
        Parameters: {
          BadParam: 'string-not-object',
          NullParam: null,
          NullTypeParam: { Type: null },
          NoTypeParam: { Default: 'missing-type' },
          GoodParam: { Type: 'String', Default: 'ok' },
        },
        Resources: {
          Instance: {
            Type: 'AWS::EC2::Instance',
            Properties: {
              InstanceType: { Ref: 'GoodParam' },
              ImageId: 'ami-abc',
            },
          },
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      // Good param resolves; bad params are skipped, no crash.
      const [stack] = parseStacks(assembly, dir);
      const inst = stack?.resources.find((r) => r.logicalId === 'Instance');
      expect(inst?.properties['InstanceType']).toBe('ok');
    });
  });

  // ── Assembly directory validation — Security Rule 1 ───────────────────────

  describe('assembly directory validation — Security Rule 1', () => {
    it('throws StackPriceError when the assembly directory does not exist', () => {
      const assembly: CloudAssembly = { version: '36.0.0', stacks: [] };
      expect(() =>
        parseStacks(assembly, '/nonexistent/path/cdk.out'),
      ).toThrow(StackPriceError);
    });

    it('uses FAILURE exit code when the assembly directory is missing', () => {
      const assembly: CloudAssembly = { version: '36.0.0', stacks: [] };
      let caught: unknown;
      try {
        parseStacks(assembly, '/nonexistent/path/cdk.out');
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).exitCode).toBe(2);
    });
  });

  // ── Resource without Properties ───────────────────────────────────────────

  describe('resource without Properties field', () => {
    it('treats a resource with no Properties as having empty properties', () => {
      const template = {
        Resources: {
          MetaResource: {
            Type: 'AWS::CDK::Metadata',
            // no Properties field
          },
        },
      };
      const dir = makeTempDir();
      writeTemplate(dir, 'Stack.template.json', template);
      const assembly = makeAssembly(dir, [
        { id: 'Stack', templateFile: 'Stack.template.json' },
      ]);

      const [stack] = parseStacks(assembly, dir);
      expect(stack?.resources).toHaveLength(1);
      expect(stack?.resources[0]?.properties).toEqual({});
    });
  });
});
