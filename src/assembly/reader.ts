import * as fs from 'fs';
import * as path from 'path';

import { EXIT_CODES, StackPriceError } from '../errors/index.js';
import { cdkV1Detected, noManifest } from '../errors/messages.js';
import type { CloudAssembly, StackEnvironment, StackManifest } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const CDK_STACK_ARTIFACT_TYPE = 'aws:cloudformation:stack';

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
 * Returns true when the manifest artifacts contain runtimeInfo that
 * positively identifies the assembly as CDK v1 — i.e. `@aws-cdk/core` is
 * present in runtimeInfo.libraries without `aws-cdk-lib`.
 *
 * The schema version number alone cannot distinguish CDK v1 from v2: CDK v1
 * produced schema versions well above 6 (e.g. v1.139.0 → schema 16.0.0).
 * The library-based check is the only reliable signal.
 *
 * Returns false (assume CDK v2) when:
 * - `aws-cdk-lib` is found anywhere → definitely CDK v2
 * - runtimeInfo or libraries fields are absent → modern assemblies may omit them
 * - No positive evidence of CDK v1 is found after walking all artifacts
 */
function isCdkV1Assembly(artifacts: Record<string, unknown>): boolean {
  for (const artifactKey of Object.keys(artifacts)) {
    const artifact = artifacts[artifactKey];
    if (typeof artifact !== 'object' || artifact === null) continue;

    const artifactRecord = artifact as Record<string, unknown>;
    const metadata = Object.prototype.hasOwnProperty.call(
      artifactRecord,
      'metadata',
    )
      ? artifactRecord['metadata']
      : undefined;

    if (typeof metadata !== 'object' || metadata === null) continue;

    const metadataRecord = metadata as Record<string, unknown>;

    for (const metaPath of Object.keys(metadataRecord)) {
      const entries = metadataRecord[metaPath];
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null) continue;

        const entryRecord = entry as Record<string, unknown>;
        const data = Object.prototype.hasOwnProperty.call(entryRecord, 'data')
          ? entryRecord['data']
          : undefined;

        if (typeof data !== 'object' || data === null) continue;

        const dataRecord = data as Record<string, unknown>;
        const runtimeInfo = Object.prototype.hasOwnProperty.call(
          dataRecord,
          'runtimeInfo',
        )
          ? dataRecord['runtimeInfo']
          : undefined;

        if (typeof runtimeInfo !== 'object' || runtimeInfo === null) continue;

        const runtimeRecord = runtimeInfo as Record<string, unknown>;
        const libraries = Object.prototype.hasOwnProperty.call(
          runtimeRecord,
          'libraries',
        )
          ? runtimeRecord['libraries']
          : undefined;

        if (typeof libraries !== 'object' || libraries === null) continue;

        const libRecord = libraries as Record<string, unknown>;

        // aws-cdk-lib present → definitely CDK v2, stop searching
        if (Object.prototype.hasOwnProperty.call(libRecord, 'aws-cdk-lib')) {
          return false;
        }

        // @aws-cdk/core without aws-cdk-lib → CDK v1
        if (Object.prototype.hasOwnProperty.call(libRecord, '@aws-cdk/core')) {
          return true;
        }
      }
    }
  }

  // No runtimeInfo or no recognisable library markers found → assume CDK v2
  return false;
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
  const artifactsMap =
    typeof parsed.artifacts === 'object' && parsed.artifacts !== null
      ? (parsed.artifacts as Record<string, unknown>)
      : {};

  if (isCdkV1Assembly(artifactsMap)) {
    throw new StackPriceError(
      cdkV1Detected(parsed.version),
      EXIT_CODES.FAILURE,
    );
  }

  // ── 6. Extract stacks from artifacts ─────────────────────────────────────
  const stacks = extractStacks(artifactsMap);

  return {
    version: parsed.version,
    stacks,
  };
}
