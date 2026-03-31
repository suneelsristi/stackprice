import * as fs from 'fs';
import * as path from 'path';

import { EXIT_CODES, StackPriceError } from '../errors/index.js';
import { cdkV1Detected, noManifest } from '../errors/messages.js';
import type { CloudAssembly, StackEnvironment, StackManifest } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CDK_STACK_ARTIFACT_TYPE = 'aws:cloudformation:stack';

/**
 * CDK cloud assembly schema version 6 is the first version produced by CDK v2.
 * Any manifest with a major schema version below this threshold is CDK v1.
 */
const MIN_CDK_V2_SCHEMA_MAJOR = 6;

// ─── Internal helpers ────────────────────────────────────────────────────────

function isValidManifestShape(
  value: unknown,
): value is { version: string; artifacts?: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(obj, 'version') &&
    typeof obj['version'] === 'string'
  );
}

/**
 * Returns true when the schema major version is below the CDK v2 threshold.
 * An unparseable version string is treated as unknown and returns false
 * (the reader will attempt to continue rather than block on a bad version).
 */
function isCdkV1Schema(version: string): boolean {
  // split('.', 1).join('') extracts the major version segment as a plain string,
  // avoiding noUncheckedIndexedAccess dead branches on array[0] ?? fallback.
  const majorStr = version.split('.', 1).join('');
  const major = parseInt(majorStr, 10);
  if (isNaN(major)) return false;
  return major < MIN_CDK_V2_SCHEMA_MAJOR;
}

/**
 * Parses the CDK environment string "aws://ACCOUNT/REGION" into its parts.
 * Returns unknown-* defaults when the string is absent or malformed.
 */
function parseEnvironment(envString: string | undefined): StackEnvironment {
  if (typeof envString !== 'string') {
    return { account: 'unknown-account', region: 'unknown-region' };
  }

  // Expected format: "aws://123456789012/us-east-1"
  const parts = envString.split('/');
  const account =
    typeof parts[2] === 'string' && parts[2].length > 0
      ? parts[2]
      : 'unknown-account';
  const region =
    typeof parts[3] === 'string' && parts[3].length > 0
      ? parts[3]
      : 'unknown-region';

  return { account, region };
}

/**
 * Extracts StackManifest entries from the raw artifacts map.
 * Silently skips artifacts that are not CloudFormation stacks or that
 * lack a templateFile — they are never needed by the pricing engine.
 */
function extractStacks(
  artifacts: Record<string, unknown>,
): StackManifest[] {
  const stacks: StackManifest[] = [];

  for (const id of Object.keys(artifacts)) {
    const artifact = artifacts[id];
    if (typeof artifact !== 'object' || artifact === null) continue;

    const artifactRecord = artifact as Record<string, unknown>;

    // Security Rule 5: use hasOwnProperty for untrusted JSON property access
    const type = Object.prototype.hasOwnProperty.call(artifactRecord, 'type')
      ? artifactRecord['type']
      : undefined;
    if (type !== CDK_STACK_ARTIFACT_TYPE) continue;

    const properties = Object.prototype.hasOwnProperty.call(
      artifactRecord,
      'properties',
    )
      ? artifactRecord['properties']
      : undefined;
    if (typeof properties !== 'object' || properties === null) continue;

    const propsRecord = properties as Record<string, unknown>;
    const templateFile = Object.prototype.hasOwnProperty.call(
      propsRecord,
      'templateFile',
    )
      ? propsRecord['templateFile']
      : undefined;
    if (typeof templateFile !== 'string') continue;

    const envString = Object.prototype.hasOwnProperty.call(
      artifactRecord,
      'environment',
    )
      ? artifactRecord['environment']
      : undefined;

    const environment = parseEnvironment(
      typeof envString === 'string' ? envString : undefined,
    );

    stacks.push({ id, templateFile, environment });
  }

  return stacks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a CDK cloud assembly from `dir` and returns a normalised
 * `CloudAssembly` value that downstream stages can consume.
 *
 * Throws `StackPriceError` with EXIT_CODES.FAILURE for:
 * - `dir` does not exist or is not a directory
 * - `manifest.json` is absent or unreadable
 * - `manifest.json` is not valid JSON
 * - manifest does not look like a CDK cloud assembly
 * - manifest schema version indicates CDK v1 (ADR-007)
 */
export function readAssembly(dir: string): CloudAssembly {
  // ── 1. Validate the directory path (Security Rule 1) ──────────────────────
  const resolved = path.resolve(dir);

  if (!fs.existsSync(resolved)) {
    throw new StackPriceError(
      `Directory not found: ${resolved}`,
      EXIT_CODES.FAILURE,
    );
  }

  if (!fs.statSync(resolved).isDirectory()) {
    throw new StackPriceError(
      `Not a directory: ${resolved}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 2. Read manifest.json ─────────────────────────────────────────────────
  const manifestPath = path.join(resolved, 'manifest.json');

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    // Pass the original user-provided dir to the message (not the resolved
    // absolute path) to avoid leaking internal filesystem layout (Rule 4).
    throw new StackPriceError(noManifest(dir), EXIT_CODES.FAILURE);
  }

  // ── 3. Parse JSON (Security Rule 2) ──────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StackPriceError(
      `manifest.json is not valid JSON: ${path.basename(manifestPath)}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 4. Validate manifest shape ────────────────────────────────────────────
  if (!isValidManifestShape(parsed)) {
    throw new StackPriceError(
      `manifest.json does not look like a CDK cloud assembly manifest: ${path.basename(manifestPath)}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 5. Detect CDK v1 (ADR-007) ───────────────────────────────────────────
  if (isCdkV1Schema(parsed.version)) {
    throw new StackPriceError(
      cdkV1Detected(parsed.version),
      EXIT_CODES.FAILURE,
    );
  }

  // ── 6. Extract stacks from artifacts ─────────────────────────────────────
  const stacks =
    typeof parsed.artifacts === 'object' &&
    parsed.artifacts !== null
      ? extractStacks(parsed.artifacts as Record<string, unknown>)
      : [];

  return {
    version: parsed.version,
    stacks,
  };
}
