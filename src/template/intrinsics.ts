import type { CfnParameter } from './types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntrinsicsContext {
  parameters: Record<string, CfnParameter>;
}

// ─── Internal resolvers ───────────────────────────────────────────────────────

/**
 * Resolves a `Ref` intrinsic. Returns the parameter's Default value when the
 * ref targets a known parameter, or null for resource refs and pseudo-parameters
 * (which cannot be resolved statically).
 */
function resolveRef(ref: unknown, ctx: IntrinsicsContext): unknown {
  if (typeof ref !== 'string') return null;

  // AWS pseudo-parameters (e.g. AWS::Region) are runtime values — cannot resolve.
  if (ref.startsWith('AWS::')) return null;

  // Parameter reference — return the Default value if one is declared.
  if (!Object.prototype.hasOwnProperty.call(ctx.parameters, ref)) return null;
  const param: CfnParameter | undefined = ctx.parameters[ref];
  /* v8 ignore next — hasOwnProperty checked above; undefined is a type-safety guard */
  if (param === undefined) return null;
  if (!Object.prototype.hasOwnProperty.call(param, 'Default')) return null;

  /* v8 ignore next — JSON cannot represent undefined; Default is always a concrete value */
  return param.Default ?? null;
}

/**
 * Resolves a `Fn::Select` intrinsic.
 * `operand` must be `[index, listOfValues]`.
 * Returns null if the index or list cannot be resolved to concrete values.
 */
function resolveFnSelect(operand: unknown, ctx: IntrinsicsContext): unknown {
  if (!Array.isArray(operand) || operand.length < 2) return null;

  const rawIndex: unknown = operand[0];
  const rawList: unknown = operand[1];
  /* v8 ignore next — length >= 2 checked above; undefined guards are type-safety only */
  if (rawIndex === undefined || rawList === undefined) return null;

  const index = resolveValue(rawIndex, ctx);
  if (typeof index !== 'number') return null;

  const list = resolveValue(rawList, ctx);
  if (!Array.isArray(list) || index < 0 || index >= list.length) return null;

  const item: unknown = list[index];
  /* v8 ignore next — index bounds checked above; undefined guard is type-safety only */
  if (item === undefined) return null;

  return resolveValue(item, ctx);
}

/**
 * Resolves a `Fn::Sub` intrinsic.
 * `operand` is either a string template or `[template, vars]`.
 * Substitutes ${VarName} tokens using the supplied vars map and then
 * parameter defaults. Leaves tokens that cannot be resolved as-is.
 */
function resolveFnSub(operand: unknown, ctx: IntrinsicsContext): unknown {
  let template: unknown;
  let vars: Record<string, unknown> = {};

  if (typeof operand === 'string') {
    template = operand;
  } else if (Array.isArray(operand) && operand.length >= 2) {
    const firstEl: unknown = operand[0];
    const secondEl: unknown = operand[1];
    /* v8 ignore next — length >= 2 checked above; undefined guard is type-safety only */
    if (firstEl === undefined) return null;
    template = firstEl;
    if (
      typeof secondEl === 'object' &&
      secondEl !== null &&
      !Array.isArray(secondEl)
    ) {
      vars = secondEl as Record<string, unknown>;
    }
  } else {
    return null;
  }

  if (typeof template !== 'string') return null;

  return template.replace(
    /\$\{([^}]+)\}/g,
    (match: string, key: string): string => {
      // Explicit vars map takes priority.
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        const rawVal: unknown = vars[key];
        const val = resolveValue(rawVal, ctx);
        return val !== null && val !== undefined ? String(val) : match;
      }
      // Fall back to parameter defaults.
      const resolved = resolveRef(key, ctx);
      return resolved !== null && resolved !== undefined
        ? String(resolved)
        : match;
    },
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Best-effort resolver for CloudFormation intrinsic functions.
 *
 * Rules:
 * - Primitives (string, number, boolean, null) are returned as-is.
 * - Arrays are mapped element-by-element.
 * - `Ref`        → parameter Default, or null for resource/pseudo refs.
 * - `Fn::If`     → null (conditions are runtime values).
 * - `Fn::Select` → resolved element, or null.
 * - `Fn::Sub`    → substituted string with unresolvable tokens left intact.
 * - Any other intrinsic or plain object → returned as-is.
 *
 * Never throws.
 */
export function resolveValue(value: unknown, ctx: IntrinsicsContext): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item: unknown) => resolveValue(item, ctx));
  }

  const obj = value as Record<string, unknown>;

  // Fn::If — conditions are dynamic (runtime); cannot resolve statically.
  if (Object.prototype.hasOwnProperty.call(obj, 'Fn::If')) return null;

  // Ref
  if (Object.prototype.hasOwnProperty.call(obj, 'Ref')) {
    return resolveRef(obj['Ref'], ctx);
  }

  // Fn::Select
  if (Object.prototype.hasOwnProperty.call(obj, 'Fn::Select')) {
    return resolveFnSelect(obj['Fn::Select'], ctx);
  }

  // Fn::Sub
  if (Object.prototype.hasOwnProperty.call(obj, 'Fn::Sub')) {
    return resolveFnSub(obj['Fn::Sub'], ctx);
  }

  // Unknown intrinsic or plain object — return as-is.
  return value;
}

/**
 * Resolves all top-level property values in a CloudFormation resource
 * Properties map, replacing intrinsic functions with their best-effort values.
 * Returns a new object; does not mutate the input.
 */
export function resolveProperties(
  properties: Record<string, unknown>,
  ctx: IntrinsicsContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const key of Object.keys(properties)) {
    // Direct access is safe here: key comes from Object.keys().
    const val: unknown = properties[key];
    resolved[key] = resolveValue(val, ctx);
  }

  return resolved;
}
