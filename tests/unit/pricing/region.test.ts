import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveRegion, readProfileRegion } from '../../../src/pricing/region.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a temporary directory containing a .aws/config file.
 * Returns the path to the config file (not the temp dir root).
 * Callers must push the temp dir onto tempDirs so afterEach cleans it up.
 */
function makeTempConfig(configContent: string, tempDirList: string[]): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackprice-region-'));
  tempDirList.push(tempDir);
  const configPath = path.join(tempDir, 'config');
  fs.writeFileSync(configPath, configContent, 'utf-8');
  return configPath;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const AWS_CONFIG_DEFAULT = `[default]
region = eu-west-1
output = json
`;

const AWS_CONFIG_NAMED_PROFILE = `[default]
region = us-east-1

[profile staging]
region = ap-southeast-1
output = json
`;

const AWS_CONFIG_NO_REGION = `[default]
output = json
`;

// ─── State ────────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];
let stderrSpy: ReturnType<typeof vi.spyOn>;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('resolveRegion', () => {
  beforeEach(() => {
    // Spy on stderr to capture step-6 warnings without polluting test output.
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    // Clear env vars that affect region resolution.
    vi.stubEnv('AWS_DEFAULT_REGION', '');
    vi.stubEnv('AWS_REGION', '');
    vi.stubEnv('AWS_PROFILE', '');
    vi.stubEnv('AWS_DEFAULT_PROFILE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    for (const dir of tempDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  // ── Step 1 — CDK template environment metadata ───────────────────────────────

  describe('step 1 — template region', () => {
    it('returns the template region when it is a valid region string', () => {
      const result = resolveRegion('us-west-2');
      expect(result).toEqual({ region: 'us-west-2', source: 'template' });
    });

    it('returns the template region regardless of env vars', () => {
      vi.stubEnv('AWS_DEFAULT_REGION', 'eu-central-1');
      const result = resolveRegion('ap-northeast-1');
      expect(result).toEqual({ region: 'ap-northeast-1', source: 'template' });
    });

    it('skips "unknown-region" and falls through to step 2', () => {
      const result = resolveRegion('unknown-region', 'eu-west-1');
      expect(result).toEqual({ region: 'eu-west-1', source: 'flag' });
    });

    it('skips an empty template region and falls through to step 2', () => {
      const result = resolveRegion('', 'sa-east-1');
      expect(result).toEqual({ region: 'sa-east-1', source: 'flag' });
    });
  });

  // ── Step 2 — --region CLI flag ───────────────────────────────────────────────

  describe('step 2 — CLI flag', () => {
    it('returns the flag region when template region is unknown-region', () => {
      const result = resolveRegion('unknown-region', 'ap-southeast-2');
      expect(result).toEqual({ region: 'ap-southeast-2', source: 'flag' });
    });

    it('does not use the flag when a valid template region is present', () => {
      const result = resolveRegion('us-east-1', 'eu-west-1');
      expect(result).toEqual({ region: 'us-east-1', source: 'template' });
    });

    it('falls through to step 3 when flagRegion is undefined', () => {
      vi.stubEnv('AWS_DEFAULT_REGION', 'ca-central-1');
      const result = resolveRegion('unknown-region');
      expect(result).toEqual({ region: 'ca-central-1', source: 'AWS_DEFAULT_REGION' });
    });
  });

  // ── Step 3 — AWS_DEFAULT_REGION ──────────────────────────────────────────────

  describe('step 3 — AWS_DEFAULT_REGION', () => {
    it('returns AWS_DEFAULT_REGION when higher-priority sources are absent', () => {
      vi.stubEnv('AWS_DEFAULT_REGION', 'ca-central-1');
      const result = resolveRegion('unknown-region');
      expect(result).toEqual({ region: 'ca-central-1', source: 'AWS_DEFAULT_REGION' });
    });

    it('takes precedence over AWS_REGION', () => {
      vi.stubEnv('AWS_DEFAULT_REGION', 'eu-north-1');
      vi.stubEnv('AWS_REGION', 'us-west-1');
      const result = resolveRegion('unknown-region');
      expect(result).toEqual({ region: 'eu-north-1', source: 'AWS_DEFAULT_REGION' });
    });

    it('falls through when AWS_DEFAULT_REGION is an empty string', () => {
      vi.stubEnv('AWS_DEFAULT_REGION', '');
      vi.stubEnv('AWS_REGION', 'me-south-1');
      const result = resolveRegion('unknown-region');
      expect(result).toEqual({ region: 'me-south-1', source: 'AWS_REGION' });
    });
  });

  // ── Step 4 — AWS_REGION ──────────────────────────────────────────────────────

  describe('step 4 — AWS_REGION', () => {
    it('returns AWS_REGION when higher-priority sources are absent', () => {
      vi.stubEnv('AWS_REGION', 'sa-east-1');
      const result = resolveRegion('unknown-region');
      expect(result).toEqual({ region: 'sa-east-1', source: 'AWS_REGION' });
    });

    it('falls through to step 5 when AWS_REGION is an empty string', () => {
      vi.stubEnv('AWS_REGION', '');
      const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'eu-west-1', source: 'profile' });
    });
  });

  // ── Step 5 — ~/.aws/config active profile ────────────────────────────────────

  describe('step 5 — profile region', () => {
    it('returns the region from the [default] profile section', () => {
      const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'eu-west-1', source: 'profile' });
    });

    it('returns the region from a named [profile staging] section', () => {
      vi.stubEnv('AWS_PROFILE', 'staging');
      const configPath = makeTempConfig(AWS_CONFIG_NAMED_PROFILE, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'ap-southeast-1', source: 'profile' });
    });

    it('uses AWS_DEFAULT_PROFILE when AWS_PROFILE is unset', () => {
      vi.stubEnv('AWS_DEFAULT_PROFILE', 'staging');
      const configPath = makeTempConfig(AWS_CONFIG_NAMED_PROFILE, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'ap-southeast-1', source: 'profile' });
    });

    it('falls through when profile section exists but has no region key', () => {
      const configPath = makeTempConfig(AWS_CONFIG_NO_REGION, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'us-east-1', source: 'default-fallback' });
    });

    it('falls through when the config file does not exist', () => {
      const result = resolveRegion('unknown-region', undefined, '/no-such-dir/config');
      expect(result).toEqual({ region: 'us-east-1', source: 'default-fallback' });
    });

    it('falls through when the named profile section is absent from the config', () => {
      vi.stubEnv('AWS_PROFILE', 'nonexistent');
      const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result).toEqual({ region: 'us-east-1', source: 'default-fallback' });
    });

    it('does not silently fall back to [default] section when a named profile is not found', () => {
      // AWS_CONFIG_DEFAULT has only [default], not [profile staging].
      // Must return default-fallback, not eu-west-1 from [default].
      vi.stubEnv('AWS_PROFILE', 'staging');
      const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
      const result = resolveRegion('unknown-region', undefined, configPath);
      expect(result.source).toBe('default-fallback');
    });
  });

  // ── Step 6 — default fallback ────────────────────────────────────────────────

  describe('step 6 — default fallback', () => {
    it('returns us-east-1 with source default-fallback when nothing resolves', () => {
      const result = resolveRegion('unknown-region', undefined, '/no-such-dir/config');
      expect(result).toEqual({ region: 'us-east-1', source: 'default-fallback' });
    });

    it('writes a warning to stderr that mentions the default region', () => {
      resolveRegion('unknown-region', undefined, '/no-such-dir/config');

      expect(stderrSpy).toHaveBeenCalled();
      const written = stderrSpy.mock.calls[0]?.[0];
      expect(typeof written === 'string' && written.includes('us-east-1')).toBe(true);
    });

    it('warning message advises using --region', () => {
      resolveRegion('unknown-region', undefined, '/no-such-dir/config');

      const written = stderrSpy.mock.calls[0]?.[0];
      expect(typeof written === 'string' && written.includes('--region')).toBe(true);
    });

    it('warning message does not include credential values or file paths (Security Rule 4)', () => {
      resolveRegion('unknown-region', undefined, '/no-such-dir/config');

      const written = stderrSpy.mock.calls[0]?.[0];
      if (typeof written !== 'string') {
        throw new Error('expected a string written to stderr');
      }
      expect(written).not.toMatch(/AWS_ACCESS_KEY/);
      expect(written).not.toMatch(/AWS_SECRET/);
      expect(written).not.toMatch(/\.aws\/config/);
      expect(written).not.toMatch(/\/home\//);
    });

    it('does not write to stderr when a region resolves without fallback', () => {
      resolveRegion('us-west-2');
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });
});

// ─── readProfileRegion ────────────────────────────────────────────────────────

describe('readProfileRegion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();

    for (const dir of tempDirs.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it('returns undefined when the config file does not exist', () => {
    expect(readProfileRegion('/no-such-dir/config')).toBeUndefined();
  });

  it('reads region from [default] section with no AWS_PROFILE set', () => {
    vi.stubEnv('AWS_PROFILE', '');
    vi.stubEnv('AWS_DEFAULT_PROFILE', '');
    const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
    expect(readProfileRegion(configPath)).toBe('eu-west-1');
  });

  it('reads region from [profile staging] when AWS_PROFILE=staging', () => {
    vi.stubEnv('AWS_PROFILE', 'staging');
    const configPath = makeTempConfig(AWS_CONFIG_NAMED_PROFILE, tempDirs);
    expect(readProfileRegion(configPath)).toBe('ap-southeast-1');
  });

  it('returns undefined when profile section has no region key', () => {
    vi.stubEnv('AWS_PROFILE', '');
    vi.stubEnv('AWS_DEFAULT_PROFILE', '');
    const configPath = makeTempConfig(AWS_CONFIG_NO_REGION, tempDirs);
    expect(readProfileRegion(configPath)).toBeUndefined();
  });

  it('returns undefined when the named profile section is not found', () => {
    vi.stubEnv('AWS_PROFILE', 'missing');
    const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
    expect(readProfileRegion(configPath)).toBeUndefined();
  });

  it('does not bleed the [default] region when a different named profile is active', () => {
    vi.stubEnv('AWS_PROFILE', 'staging');
    // AWS_CONFIG_DEFAULT only has [default], not [profile staging]
    const configPath = makeTempConfig(AWS_CONFIG_DEFAULT, tempDirs);
    expect(readProfileRegion(configPath)).toBeUndefined();
  });
});
