import * as fs from 'fs';
import * as path from 'path';

import { EXIT_CODES, StackPriceError } from '../errors/index.js';
import { resolveRegion } from '../pricing/region.js';
import type { CloudAssembly, StackManifest } from '../assembly/types.js';
import type { IntrinsicsContext } from './intrinsics.js';
import { resolveProperties } from './intrinsics.js';
import type {
  CfnParameter,
  ConditionalResourceRecord,
  ParsedStack,
  ResourceRecord,
} from './types.js';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Builds an IntrinsicsContext from a raw (unparsed) Parameters block.
 * Silently skips malformed parameter entries — they will be unresolvable
 * during intrinsics resolution and the handler will return null instead.
 */
function buildIntrinsicsContext(rawParameters: unknown): IntrinsicsContext {
  const parameters: Record<string, CfnParameter> = {};

  if (
    typeof rawParameters !== 'object' ||
    rawParameters === null ||
    Array.isArray(rawParameters)
  ) {
    return { parameters };
  }

  const paramsObj = rawParameters as Record<string, unknown>;

  for (const paramName of Object.keys(paramsObj)) {
    // Direct access is safe here: paramName comes from Object.keys().
    const paramVal: unknown = paramsObj[paramName];

    if (typeof paramVal !== 'object' || paramVal === null) continue;

    const p = paramVal as Record<string, unknown>;
    const paramType = Object.prototype.hasOwnProperty.call(p, 'Type')
      ? p['Type']
      : undefined;

    if (typeof paramType !== 'string') continue;

    parameters[paramName] = Object.prototype.hasOwnProperty.call(p, 'Default')
      ? { Type: paramType, Default: p['Default'] }
      : { Type: paramType };
  }

  return { parameters };
}

/**
 * Extracts ResourceRecord and ConditionalResourceRecord arrays from a raw
 * CloudFormation Resources block. Silently skips entries that lack a Type
 * string — they are structurally invalid and cannot be priced.
 */
function extractResources(
  rawResources: Record<string, unknown>,
  ctx: IntrinsicsContext,
): {
  resources: ResourceRecord[];
  conditionalResources: ConditionalResourceRecord[];
} {
  const resources: ResourceRecord[] = [];
  const conditionalResources: ConditionalResourceRecord[] = [];

  for (const logicalId of Object.keys(rawResources)) {
    // Direct access is safe here: logicalId comes from Object.keys().
    const raw: unknown = rawResources[logicalId];

    if (typeof raw !== 'object' || raw === null) continue;

    const rawObj = raw as Record<string, unknown>;

    // Security Rule 5: use hasOwnProperty for untrusted JSON property access.
    const type: unknown = Object.prototype.hasOwnProperty.call(rawObj, 'Type')
      ? rawObj['Type']
      : undefined;
    if (typeof type !== 'string') continue;

    // Treat absent or non-object Properties as empty — some resource types
    // (e.g. AWS::CDK::Metadata) legitimately omit the Properties block.
    const rawProps: unknown = Object.prototype.hasOwnProperty.call(
      rawObj,
      'Properties',
    )
      ? rawObj['Properties']
      : undefined;

    const propertiesSource: Record<string, unknown> =
      typeof rawProps === 'object' &&
      rawProps !== null &&
      !Array.isArray(rawProps)
        ? (rawProps as Record<string, unknown>)
        : {};

    const properties = resolveProperties(propertiesSource, ctx);

    const condition: unknown = Object.prototype.hasOwnProperty.call(
      rawObj,
      'Condition',
    )
      ? rawObj['Condition']
      : undefined;

    if (typeof condition === 'string') {
      // ADR-011: resources with a Condition field are excluded from cost totals
      // and shown separately.
      conditionalResources.push({ logicalId, type, properties, conditionName: condition });
    } else {
      resources.push({ logicalId, type, properties });
    }
  }

  return { resources, conditionalResources };
}

/**
 * Parses a single CloudFormation template file and returns a ParsedStack.
 * Throws StackPriceError for fatal failures (unreadable file, malformed JSON).
 * Returns empty resource arrays when the template has no Resources block.
 */
function parseStack(
  stackManifest: StackManifest,
  assemblyDir: string,
  flagRegion: string | undefined,
): ParsedStack {
  const { region, source: regionSource } = resolveRegion(
    stackManifest.environment.region,
    flagRegion,
  );

  // ── 1. Validate and construct the template file path (Security Rule 1) ──────
  const templatePath = path.join(assemblyDir, stackManifest.templateFile);
  const resolvedTemplatePath = path.resolve(templatePath);

  if (!fs.existsSync(resolvedTemplatePath)) {
    throw new StackPriceError(
      `Template file not found: ${stackManifest.templateFile}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 2. Read the template file ─────────────────────────────────────────────
  let raw: string;
  try {
    raw = fs.readFileSync(resolvedTemplatePath, 'utf-8');
  } catch {
    throw new StackPriceError(
      `Cannot read template file: ${stackManifest.templateFile}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 3. Parse JSON (Security Rule 2) ──────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StackPriceError(
      `Template is not valid JSON: ${stackManifest.templateFile}`,
      EXIT_CODES.FAILURE,
    );
  }

  // ── 4. Top-level shape check — must be a plain object ────────────────────
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new StackPriceError(
      `Template does not look like a CloudFormation template: ${stackManifest.templateFile}`,
      EXIT_CODES.FAILURE,
    );
  }

  const templateObj = parsed as Record<string, unknown>;

  // ── 5. Build intrinsics context from Parameters ───────────────────────────
  const rawParameters: unknown = Object.prototype.hasOwnProperty.call(
    templateObj,
    'Parameters',
  )
    ? templateObj['Parameters']
    : undefined;
  const ctx = buildIntrinsicsContext(rawParameters);

  // ── 6. Extract Resources — absent or empty is valid (return empty arrays) ─
  const rawResources: unknown = Object.prototype.hasOwnProperty.call(
    templateObj,
    'Resources',
  )
    ? templateObj['Resources']
    : undefined;

  if (
    typeof rawResources !== 'object' ||
    rawResources === null ||
    Array.isArray(rawResources)
  ) {
    return {
      stackId: stackManifest.id,
      region,
      regionSource,
      resources: [],
      conditionalResources: [],
      unsupportedTypes: [],
    };
  }

  const { resources, conditionalResources } = extractResources(
    rawResources as Record<string, unknown>,
    ctx,
  );

  return {
    stackId: stackManifest.id,
    region,
    regionSource,
    resources,
    conditionalResources,
    unsupportedTypes: [],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads and parses every CloudFormation template referenced in the
 * CloudAssembly, returning a ParsedStack for each stack.
 *
 * @param assembly     The CloudAssembly produced by Stage 2 (Assembly Reader).
 * @param assemblyDir  Path to the cdk.out directory that contains the template files.
 * @param flagRegion   Optional --region CLI flag value (overrides template/env).
 */
export function parseStacks(
  assembly: CloudAssembly,
  assemblyDir: string,
  flagRegion?: string,
): ParsedStack[] {
  // Resolve and validate the assembly directory path (Security Rule 1).
  const resolved = path.resolve(assemblyDir);

  if (!fs.existsSync(resolved)) {
    throw new StackPriceError(
      `Assembly directory not found: ${path.basename(assemblyDir)}`,
      EXIT_CODES.FAILURE,
    );
  }

  return assembly.stacks.map((stack: StackManifest) =>
    parseStack(stack, resolved, flagRegion),
  );
}
