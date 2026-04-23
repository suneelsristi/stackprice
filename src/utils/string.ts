/**
 * Strips the 8-character CDK hash suffix from a logical ID.
 * CDK auto-generates suffixes like "99EDD300" (all [0-9A-F], first 4 contain
 * at least one letter A-F). Returns the original string if no suffix matches.
 */
export function stripCdkHash(logicalId: string): string {
  if (logicalId.length <= 8) return logicalId;
  const suffix = logicalId.slice(-8);
  if (!/^[0-9A-F]{8}$/.test(suffix)) return logicalId;
  if (!/[A-F]/.test(suffix.slice(0, 4))) return logicalId;
  return logicalId.slice(0, -8);
}
