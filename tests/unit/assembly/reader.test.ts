import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readAssembly } from '../../../src/assembly/reader.js';
import { StackPriceError } from '../../../src/errors/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_V2_MANIFEST = {
  version: '36.0.0',
  artifacts: {
    MyStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://123456789012/us-east-1',
      properties: {
        templateFile: 'MyStack.template.json',
      },
    },
    AnotherStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://123456789012/eu-west-1',
      properties: {
        templateFile: 'AnotherStack.template.json',
      },
    },
  },
};

const VALID_V2_MANIFEST_SINGLE_STACK = {
  version: '36.0.0',
  artifacts: {
    WebStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://987654321098/us-west-2',
      properties: {
        templateFile: 'WebStack.template.json',
      },
    },
  },
};

const CDK_V1_MANIFEST = {
  version: '5.0.0',
  artifacts: {
    MyStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://123456789012/us-east-1',
      properties: {
        templateFile: 'MyStack.template.json',
      },
    },
  },
};

const MANIFEST_WITH_MIXED_ARTIFACT_TYPES = {
  version: '17.0.0',
  artifacts: {
    AppStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://111111111111/ap-southeast-1',
      properties: {
        templateFile: 'AppStack.template.json',
      },
    },
    AssetManifest: {
      type: 'cdk:asset-manifest',
      properties: {
        file: 'manifest.json',
      },
    },
    TreeArtifact: {
      type: 'cdk:tree',
      properties: {
        file: 'tree.json',
      },
    },
  },
};

const MANIFEST_WITHOUT_REGION = {
  version: '12.0.0',
  artifacts: {
    NoEnvStack: {
      type: 'aws:cloudformation:stack',
      properties: {
        templateFile: 'NoEnvStack.template.json',
      },
    },
  },
};

const MANIFEST_NO_ARTIFACTS = {
  version: '36.0.0',
};

const EXACT_BOUNDARY_VERSION_6 = {
  version: '6.0.0',
  artifacts: {
    BoundaryStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://123456789012/us-east-1',
      properties: {
        templateFile: 'BoundaryStack.template.json',
      },
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(manifest?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackprice-test-'));
  tempDirs.push(dir);

  if (manifest !== undefined) {
    const content =
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
    fs.writeFileSync(path.join(dir, 'manifest.json'), content, 'utf-8');
  }

  return dir;
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

// ─── readAssembly ─────────────────────────────────────────────────────────────

describe('readAssembly', () => {
  describe('happy path — valid CDK v2 manifest', () => {
    it('returns the schema version from the manifest', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      const result = readAssembly(dir);
      expect(result.version).toBe('36.0.0');
    });

    it('returns all stacks found in artifacts', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(2);
    });

    it('maps artifact key to stack id', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      const result = readAssembly(dir);
      const ids = result.stacks.map((s) => s.id);
      expect(ids).toContain('MyStack');
      expect(ids).toContain('AnotherStack');
    });

    it('extracts templateFile from properties', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST_SINGLE_STACK);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.templateFile).toBe('WebStack.template.json');
    });

    it('extracts AWS account from environment string', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST_SINGLE_STACK);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.account).toBe('987654321098');
    });

    it('extracts AWS region from environment string', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST_SINGLE_STACK);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.region).toBe('us-west-2');
    });

    it('accepts schema version exactly at boundary (6.0.0) as CDK v2', () => {
      const dir = makeTempDir(EXACT_BOUNDARY_VERSION_6);
      const result = readAssembly(dir);
      expect(result.version).toBe('6.0.0');
      expect(result.stacks).toHaveLength(1);
    });
  });

  describe('mixed artifact types', () => {
    it('includes only aws:cloudformation:stack artifacts as stacks', () => {
      const dir = makeTempDir(MANIFEST_WITH_MIXED_ARTIFACT_TYPES);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
      expect(result.stacks[0]?.id).toBe('AppStack');
    });

    it('ignores cdk:asset-manifest artifacts', () => {
      const dir = makeTempDir(MANIFEST_WITH_MIXED_ARTIFACT_TYPES);
      const result = readAssembly(dir);
      const ids = result.stacks.map((s) => s.id);
      expect(ids).not.toContain('AssetManifest');
    });

    it('ignores cdk:tree artifacts', () => {
      const dir = makeTempDir(MANIFEST_WITH_MIXED_ARTIFACT_TYPES);
      const result = readAssembly(dir);
      const ids = result.stacks.map((s) => s.id);
      expect(ids).not.toContain('TreeArtifact');
    });
  });

  describe('missing or unknown environment', () => {
    it('defaults account to unknown-account when environment is absent', () => {
      const dir = makeTempDir(MANIFEST_WITHOUT_REGION);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.account).toBe('unknown-account');
    });

    it('defaults region to unknown-region when environment is absent', () => {
      const dir = makeTempDir(MANIFEST_WITHOUT_REGION);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.region).toBe('unknown-region');
    });
  });

  describe('manifest with no artifacts field', () => {
    it('returns an empty stacks array', () => {
      const dir = makeTempDir(MANIFEST_NO_ARTIFACTS);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(0);
    });
  });

  describe('CDK v1 detection — ADR-007', () => {
    it('throws StackPriceError for schema version 5.0.0', () => {
      const dir = makeTempDir(CDK_V1_MANIFEST);
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('uses FAILURE exit code for CDK v1', () => {
      const dir = makeTempDir(CDK_V1_MANIFEST);
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(StackPriceError);
      expect((caught as StackPriceError).exitCode).toBe(2);
    });

    it('includes the detected schema version in the error message', () => {
      const dir = makeTempDir(CDK_V1_MANIFEST);
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).message).toContain('5.0.0');
    });

    it('throws for schema version 1.0.0 (older CDK v1)', () => {
      const dir = makeTempDir({ ...CDK_V1_MANIFEST, version: '1.0.0' });
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('does NOT throw for schema version 6.0.0 (CDK v2 boundary)', () => {
      const dir = makeTempDir(EXACT_BOUNDARY_VERSION_6);
      expect(() => readAssembly(dir)).not.toThrow();
    });

    it('does NOT throw for schema version 36.0.0 (CDK v2)', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      expect(() => readAssembly(dir)).not.toThrow();
    });
  });

  describe('missing manifest.json', () => {
    it('throws StackPriceError when manifest.json does not exist', () => {
      const dir = makeTempDir(); // no manifest written
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('uses FAILURE exit code when manifest is missing', () => {
      const dir = makeTempDir();
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).exitCode).toBe(2);
    });

    it('mentions cdk synth in the error message', () => {
      const dir = makeTempDir();
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).message).toContain('cdk synth');
    });
  });

  describe('malformed JSON manifest', () => {
    it('throws StackPriceError for non-JSON content', () => {
      const dir = makeTempDir('this is not json {{{');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('uses FAILURE exit code for malformed JSON', () => {
      const dir = makeTempDir('{ broken json');
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).exitCode).toBe(2);
    });
  });

  describe('invalid manifest shape', () => {
    it('throws StackPriceError when manifest is a JSON array', () => {
      const dir = makeTempDir('[]');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('throws StackPriceError when manifest has no version field', () => {
      const dir = makeTempDir('{"artifacts": {}}');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('throws StackPriceError when version is not a string', () => {
      const dir = makeTempDir('{"version": 36}');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });
  });

  describe('path validation — Security Rule 1', () => {
    it('throws StackPriceError when directory does not exist', () => {
      expect(() => readAssembly('/nonexistent/path/cdk.out')).toThrow(
        StackPriceError,
      );
    });

    it('uses FAILURE exit code when directory does not exist', () => {
      let caught: unknown;
      try {
        readAssembly('/nonexistent/path/cdk.out');
      } catch (err) {
        caught = err;
      }
      expect((caught as StackPriceError).exitCode).toBe(2);
    });

    it('throws StackPriceError when path points to a file not a directory', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      const filePath = path.join(dir, 'manifest.json');
      expect(() => readAssembly(filePath)).toThrow(StackPriceError);
    });

    it('resolves relative paths correctly', () => {
      // Use os.tmpdir() as a valid directory; it has no manifest.json
      // so it should throw the "missing manifest" error (not "dir not found")
      const dir = makeTempDir();
      const relative = path.relative(process.cwd(), dir);
      expect(() => readAssembly(relative)).toThrow(StackPriceError);
    });
  });

  describe('stacks with missing templateFile', () => {
    it('skips stack artifacts that have no templateFile in properties', () => {
      const manifest = {
        version: '36.0.0',
        artifacts: {
          ValidStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: {
              templateFile: 'ValidStack.template.json',
            },
          },
          NoTemplateStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: {}, // no templateFile
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
      expect(result.stacks[0]?.id).toBe('ValidStack');
    });
  });

  // ── Branch coverage: isValidManifestShape ──────────────────────────────────

  describe('manifest that is a non-object JSON value', () => {
    it('throws StackPriceError when manifest is a JSON string', () => {
      // JSON.parse('"a-string"') → string → typeof !== 'object'
      const dir = makeTempDir('"a-string"');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('throws StackPriceError when manifest is a JSON number', () => {
      const dir = makeTempDir('42');
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });
  });

  // ── Branch coverage: isCdkV1Schema ────────────────────────────────────────

  describe('manifest with non-numeric version string', () => {
    it('does not treat non-numeric version as CDK v1 (does not throw CDK v1 error)', () => {
      // isNaN branch: parseInt("abc", 10) = NaN → isCdkV1Schema returns false
      const dir = makeTempDir({ version: 'abc.0.0', artifacts: {} });
      const result = readAssembly(dir);
      expect(result.version).toBe('abc.0.0');
    });

    it('returns empty stacks for a manifest with non-numeric version and no stacks', () => {
      const dir = makeTempDir({ version: 'abc.0.0', artifacts: {} });
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(0);
    });
  });

  // ── Branch coverage: parseEnvironment ────────────────────────────────────

  describe('environment string edge cases', () => {
    it('defaults account to unknown-account when environment has empty account segment', () => {
      // "aws:///us-east-1".split('/') = ['aws:', '', '', 'us-east-1']
      // parts[2] = '' → length 0 → falls back to unknown-account
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws:///us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.account).toBe('unknown-account');
      expect(result.stacks[0]?.environment.region).toBe('us-east-1');
    });

    it('defaults region to unknown-region when environment has empty region segment', () => {
      // "aws://123456789012/".split('/') = ['aws:', '', '123456789012', '']
      // parts[3] = '' → length 0 → falls back to unknown-region
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/',
            properties: { templateFile: 'MyStack.template.json' },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.account).toBe('123456789012');
      expect(result.stacks[0]?.environment.region).toBe('unknown-region');
    });

    it('defaults both to unknown when environment has no slash-separated segments', () => {
      // "aws:".split('/') = ['aws:'] → parts[2] and parts[3] are undefined
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws:',
            properties: { templateFile: 'MyStack.template.json' },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks[0]?.environment.account).toBe('unknown-account');
      expect(result.stacks[0]?.environment.region).toBe('unknown-region');
    });
  });

  // ── Branch coverage: extractStacks artifact edge cases ────────────────────

  describe('artifact edge cases in extractStacks', () => {
    it('skips a null artifact value', () => {
      // artifact === null → the null branch of (typeof !== 'object' || === null)
      const manifest = {
        version: '36.0.0',
        artifacts: {
          ValidStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'Valid.template.json' },
          },
          NullArtifact: null,
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
      expect(result.stacks[0]?.id).toBe('ValidStack');
    });

    it('skips an artifact object with no type property', () => {
      // hasOwnProperty('type') = false → type = undefined → not a stack
      const manifest = {
        version: '36.0.0',
        artifacts: {
          NoTypeArtifact: {
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'NoType.template.json' },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(0);
    });

    it('skips a stack artifact with no properties field', () => {
      // hasOwnProperty('properties') = false → properties = undefined → continue
      const manifest = {
        version: '36.0.0',
        artifacts: {
          NoPropsStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(0);
    });

    it('skips a stack artifact with null properties', () => {
      // hasOwnProperty('properties') = true, but properties === null → continue
      const manifest = {
        version: '36.0.0',
        artifacts: {
          NullPropsStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: null,
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(0);
    });
  });
});
