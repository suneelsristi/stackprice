import type { PricedStack } from '../pricing/types.js';

export function formatSummary(stacks: PricedStack[], startTime: number): string {
  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);

  const totalMonthlyCost = stacks.reduce((sum, s) => sum + s.stackMonthlyCost, 0);
  const totalStacks = stacks.length;
  const pricedCount = stacks.reduce((sum, s) => sum + s.pricedResources.length, 0);
  const usageBasedCount = stacks.reduce((sum, s) => sum + s.usageBasedResources.length, 0);
  const estimatedCount = stacks.reduce((sum, s) => sum + s.estimatedResources.length, 0);
  const estimatedCost = stacks.reduce(
    (sum, s) => sum + s.estimatedResources.reduce((s2, r) => s2 + r.estimatedMonthlyCost, 0),
    0,
  );

  const fixedCost = totalMonthlyCost - estimatedCost;
  const onlyUsageBased = pricedCount === 0 && estimatedCount === 0 && usageBasedCount > 0;

  let costStr: string;
  if (onlyUsageBased) {
    costStr = 'N/A';
  } else if (estimatedCount > 0 && usageBasedCount > 0) {
    costStr = `$${fixedCost.toFixed(2)}/month + ~$${estimatedCost.toFixed(2)} estimated + usage-based`;
  } else if (estimatedCount > 0) {
    costStr = `$${fixedCost.toFixed(2)}/month + ~$${estimatedCost.toFixed(2)} estimated`;
  } else {
    costStr = `$${totalMonthlyCost.toFixed(2)}/month`;
  }

  const parts: string[] = [
    `TOTAL: ${costStr}`,
  ];

  if (usageBasedCount > 0 && estimatedCount === 0) {
    parts[0] += ' + usage-based';
  }

  parts.push(`${totalStacks} stack${totalStacks !== 1 ? 's' : ''}`);
  parts.push(`${pricedCount} priced`);

  if (estimatedCount > 0) {
    parts.push(`${estimatedCount} estimated`);
  }

  if (usageBasedCount > 0) {
    parts.push(`${usageBasedCount} usage-based`);
  }

  parts.push(`${elapsedSec}s`);

  return parts.join(' · ');
}
