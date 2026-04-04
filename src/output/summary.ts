import type { PricedStack } from '../pricing/types.js';

export function formatSummary(stacks: PricedStack[], startTime: number): string {
  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  const totalMonthlyCost = stacks.reduce((sum, s) => sum + s.stackMonthlyCost, 0);
  const totalStacks = stacks.length;
  const pricedCount = stacks.reduce((sum, s) => sum + s.pricedResources.length, 0);
  const usageBasedCount = stacks.reduce((sum, s) => sum + s.usageBasedResources.length, 0);

  const onlyUsageBased = pricedCount === 0 && usageBasedCount > 0;
  const costStr = onlyUsageBased ? 'N/A' : `$${totalMonthlyCost.toFixed(2)}/month`;

  const parts: string[] = [
    `TOTAL: ${costStr}`,
  ];

  if (usageBasedCount > 0) {
    parts[0] += ' + usage-based';
  }

  parts.push(`${totalStacks} stack${totalStacks !== 1 ? 's' : ''}`);
  parts.push(`${pricedCount} priced`);

  if (usageBasedCount > 0) {
    parts.push(`${usageBasedCount} usage-based`);
  }

  parts.push(`${elapsedSec}s`);

  return parts.join(' · ');
}
