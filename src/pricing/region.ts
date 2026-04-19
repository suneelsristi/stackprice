import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import chalk from 'chalk';

import type { RegionSource } from '../template/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegionResolution {
  region: string;
  source: RegionSource;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNKNOWN_REGION = 'unknown-region';
const DEFAULT_REGION = 'us-east-1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads the AWS region for the active profile from the given config file path.
 *
 * Active profile is determined by (in priority order):
 *   AWS_PROFILE → AWS_DEFAULT_PROFILE → 'default'
 *
 * Accepts an explicit configPath so callers (and tests) can supply any path
 * without touching the real ~/.aws/config file.
 *
 * Returns undefined when:
 * - the config file does not exist or cannot be read
 * - the active profile section is absent
 * - no region key is found inside the profile section
 */
export function readProfileRegion(configPath: string): string | undefined {
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return undefined;
  }

  // Use || so that empty strings fall through (vi.stubEnv sets '' not undefined).
  const profileName =
    process.env['AWS_PROFILE'] ||
    process.env['AWS_DEFAULT_PROFILE'] ||
    'default';

  // ~/.aws/config uses [default] for the default profile and
  // [profile <name>] for named profiles.
  const sectionPattern =
    profileName === 'default'
      ? /^\s*\[default\]/m
      : new RegExp(`^\\s*\\[profile\\s+${escapeRegex(profileName)}\\]`, 'm');

  const sectionMatch = sectionPattern.exec(content);
  if (!sectionMatch) return undefined;

  // Slice the content from immediately after the section header.
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const afterSection = content.slice(sectionStart);

  // Stop at the next section header so we only read our profile's keys.
  const nextSectionMatch = /^\s*\[/m.exec(afterSection);
  const sectionContent = nextSectionMatch
    ? afterSection.slice(0, nextSectionMatch.index)
    : afterSection;

  const regionMatch = /^\s*region\s*=\s*(\S+)/m.exec(sectionContent);
  return regionMatch?.[1];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolves the AWS region for a stack using the full ADR-008 resolution chain.
 *
 * Priority order:
 *   1. Region in CDK template environment metadata   → source: 'template'
 *   2. --region CLI flag                             → source: 'flag'
 *   3. AWS_DEFAULT_REGION environment variable       → source: 'AWS_DEFAULT_REGION'
 *   4. AWS_REGION environment variable               → source: 'AWS_REGION'
 *   5. ~/.aws/config active profile region           → source: 'profile'
 *   6. None found → warn to stderr, default us-east-1, source: 'default-fallback'
 *
 * @param templateRegion  Region from CDK assembly environment (or 'unknown-region').
 * @param flagRegion      Optional --region CLI flag value.
 * @param awsConfigPath   Optional override for the AWS config file path. Defaults to
 *                        ~/.aws/config. Provided as a parameter so callers and tests
 *                        can supply a controlled path without touching the real config.
 *
 * Security Rule 4: the stderr warning never includes credential values,
 * account IDs, or internal filesystem paths.
 */
export function resolveRegion(
  templateRegion: string,
  flagRegion?: string,
  awsConfigPath?: string,
): RegionResolution {
  // Step 1: CDK template environment metadata.
  // CDK uses 'unknown-region' for environment-agnostic stacks.
  if (templateRegion && templateRegion !== UNKNOWN_REGION) {
    return { region: templateRegion, source: 'template' };
  }

  // Step 2: --region CLI flag.
  if (flagRegion) {
    return { region: flagRegion, source: 'flag' };
  }

  // Step 3: AWS_DEFAULT_REGION environment variable.
  const defaultRegionEnv = process.env['AWS_DEFAULT_REGION'];
  if (defaultRegionEnv) {
    return { region: defaultRegionEnv, source: 'AWS_DEFAULT_REGION' };
  }

  // Step 4: AWS_REGION environment variable.
  const awsRegionEnv = process.env['AWS_REGION'];
  if (awsRegionEnv) {
    return { region: awsRegionEnv, source: 'AWS_REGION' };
  }

  // Step 5: ~/.aws/config active profile.
  const configPath = awsConfigPath ?? path.join(os.homedir(), '.aws', 'config');
  const profileRegion = readProfileRegion(configPath);
  if (profileRegion) {
    return { region: profileRegion, source: 'profile' };
  }

  // Step 6: Default fallback — warn to stderr (Security Rule 7: warnings → stderr).
  process.stderr.write(
    chalk.yellow(
      `⚠ Region not determined. Defaulting to ${DEFAULT_REGION}.\n` +
        `  Use --region to specify a region explicitly.\n`,
    ),
  );

  return { region: DEFAULT_REGION, source: 'default-fallback' };
}
