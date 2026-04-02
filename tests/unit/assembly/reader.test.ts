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

// CDK v1 manifests are detected via runtimeInfo.libraries containing
// @aws-cdk/core without aws-cdk-lib, not by schema version number.
// CDK v1 produced schema versions well above 6 (e.g. v1.139.0 → schema 16.0.0).
const CDK_V1_MANIFEST = {
  version: '16.0.0',
  artifacts: {
    MyStack: {
      type: 'aws:cloudformation:stack',
      environment: 'aws://123456789012/us-east-1',
      properties: {
        templateFile: 'MyStack.template.json',
      },
      metadata: {
        '/MyStack': [
          {
            type: 'aws:cdk:app',
            data: {
              runtimeInfo: {
                libraries: {
                  '@aws-cdk/core': '1.139.0',
                  '@aws-cdk/aws-s3': '1.139.0',
                },
              },
            },
          },
        ],
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
    it('throws StackPriceError when @aws-cdk/core is present without aws-cdk-lib', () => {
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

    it('includes the schema version in the error message', () => {
      const dir = makeTempDir(CDK_V1_MANIFEST);
      let caught: unknown;
      try {
        readAssembly(dir);
      } catch (err) {
        caught = err;
      }
      // CDK_V1_MANIFEST has schema version '16.0.0' — a version CDK v1 actually produced
      expect((caught as StackPriceError).message).toContain('16.0.0');
    });

    it('throws for high schema version when @aws-cdk/core is present (old detection was wrong)', () => {
      // This test proves the old schema-version < 6 check was incorrect:
      // CDK v1 produced schema versions like 16.0.0, 20.0.0, etc.
      const v1HighSchemaManifest = {
        ...CDK_V1_MANIFEST,
        version: '20.0.0',
      };
      const dir = makeTempDir(v1HighSchemaManifest);
      expect(() => readAssembly(dir)).toThrow(StackPriceError);
    });

    it('does NOT throw when aws-cdk-lib is present (CDK v2)', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST);
      expect(() => readAssembly(dir)).not.toThrow();
    });

    it('does NOT throw when aws-cdk-lib and @aws-cdk/core are both present (aws-cdk-lib wins)', () => {
      const mixedLibManifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [
                {
                  type: 'aws:cdk:app',
                  data: {
                    runtimeInfo: {
                      libraries: {
                        'aws-cdk-lib': '2.100.0',
                        '@aws-cdk/core': '1.139.0', // transitional/compat layer
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      };
      const dir = makeTempDir(mixedLibManifest);
      expect(() => readAssembly(dir)).not.toThrow();
    });

    it('does NOT throw when runtimeInfo is absent (defaults to CDK v2)', () => {
      // Modern assemblies may omit runtimeInfo entirely — assume v2
      const dir = makeTempDir(EXACT_BOUNDARY_VERSION_6);
      expect(() => readAssembly(dir)).not.toThrow();
    });

    it('does NOT throw when artifacts have no metadata field (defaults to CDK v2)', () => {
      const dir = makeTempDir(VALID_V2_MANIFEST_SINGLE_STACK);
      expect(() => readAssembly(dir)).not.toThrow();
    });

    it('does NOT throw when manifest has no artifacts (defaults to CDK v2)', () => {
      const dir = makeTempDir(MANIFEST_NO_ARTIFACTS);
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

  // ── Branch coverage: isCdkV1Assembly ─────────────────────────────────────

  describe('isCdkV1Assembly branch coverage', () => {
    it('does not throw for a manifest with non-numeric version and no library markers', () => {
      // Non-numeric version strings are valid — schema version is not used for detection
      const dir = makeTempDir({ version: 'abc.0.0', artifacts: {} });
      const result = readAssembly(dir);
      expect(result.version).toBe('abc.0.0');
    });

    it('skips artifacts with non-array metadata entries', () => {
      // metadataRecord[metaPath] is not an array → continue branch
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': 'not-an-array', // non-array → skipped
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips metadata entries with null data field', () => {
      // data === null → continue branch
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [{ type: 'aws:cdk:app', data: null }],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips metadata entries with non-object runtimeInfo', () => {
      // runtimeInfo is a string → not object → continue branch
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [
                { type: 'aws:cdk:app', data: { runtimeInfo: 'not-an-object' } },
              ],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips metadata entries with null libraries field', () => {
      // libraries === null → continue branch
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [
                {
                  type: 'aws:cdk:app',
                  data: { runtimeInfo: { libraries: null } },
                },
              ],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips a null entry in the metadata entries array', () => {
      // typeof entry !== 'object' || entry === null → continue branch (null case)
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [null],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips a metadata entry that has no data property', () => {
      // hasOwnProperty('data') → false → data = undefined → typeof !== 'object' → continue
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [{ type: 'aws:cdk:asset' }], // no data field
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips a metadata entry where data has no runtimeInfo property', () => {
      // hasOwnProperty('runtimeInfo') → false → runtimeInfo = undefined → typeof !== 'object' → continue
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [{ type: 'aws:cdk:app', data: { otherField: true } }],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('skips a metadata entry where runtimeInfo has no libraries property', () => {
      // hasOwnProperty('libraries') → false → libraries = undefined → typeof !== 'object' → continue
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [
                { type: 'aws:cdk:app', data: { runtimeInfo: { version: '2.0.0' } } },
              ],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      const result = readAssembly(dir);
      expect(result.stacks).toHaveLength(1);
    });

    it('does NOT throw when libraries contains neither aws-cdk-lib nor @aws-cdk/core', () => {
      // Both hasOwnProperty checks return false → falls through → returns false (assume v2)
      const manifest = {
        version: '36.0.0',
        artifacts: {
          MyStack: {
            type: 'aws:cloudformation:stack',
            environment: 'aws://123456789012/us-east-1',
            properties: { templateFile: 'MyStack.template.json' },
            metadata: {
              '/MyStack': [
                {
                  type: 'aws:cdk:app',
                  data: {
                    runtimeInfo: {
                      libraries: { 'some-other-lib': '1.0.0' },
                    },
                  },
                },
              ],
            },
          },
        },
      };
      const dir = makeTempDir(manifest);
      expect(() => readAssembly(dir)).not.toThrow();
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
