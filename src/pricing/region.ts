import type { RegionSource } from '../template/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegionResolution {
  region: string;
  source: RegionSource;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Resolves the AWS region for a stack using the full ADR-008 resolution chain.
 *
 * Stub implementation — module 4 will replace this with:
 *   1. Region in CDK template metadata   → source: 'template'
 *   2. --region CLI flag                 → source: 'flag'
 *   3. AWS_DEFAULT_REGION env var        → source: 'AWS_DEFAULT_REGION'
 *   4. AWS_REGION env var                → source: 'AWS_REGION'
 *   5. ~/.aws/config active profile      → source: 'profile'
 *   6. None found                        → warn + default us-east-1, source: 'default-fallback'
 */
export function resolveRegion(
  _templateRegion: string,
  _flagRegion?: string,
): RegionResolution {
  return { region: 'us-east-1', source: 'default-fallback' };
}
