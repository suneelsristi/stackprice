import Table from 'cli-table3';
import chalk from 'chalk';
import type { BreakdownResult } from './types.js';
import type {
  DiffResult,
  DiffSummary,
  ResourceDiff,
  ResourceChangeKind,
  UsageBasedDiff,
} from './diff-types.js';

function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatUnitPrice(price: number): string {
  let raw: string;
  if (price >= 0.01) raw = price.toFixed(2);
  else if (price >= 0.0001) raw = price.toFixed(4);
  else if (price >= 0.0000001) raw = price.toFixed(7);
  else raw = price.toFixed(10);
  const stripped = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `$${stripped}`;
}

function formatDelta(delta: number, deltaPercent: number | null): string {
  const prefix = delta >= 0 ? '+' : '-';
  const costStr = `${prefix}$${Math.abs(delta).toFixed(2)}`;
  if (deltaPercent === null) {
    return costStr;
  }
  const pctPrefix = deltaPercent >= 0 ? '+' : '-';
  return `${costStr} (${pctPrefix}${Math.round(Math.abs(deltaPercent))}%)`;
}

export function computeDiff(
  before: BreakdownResult,
  after: BreakdownResult,
  beforeFile: string,
  afterFile: string,
): DiffResult {
  type PricedEntry = { stackId: string; logicalId: string; type: string; monthlyCost: number };
  type UsageEntry = { stackId: string; logicalId: string; type: string; unitPrice: number };

  const beforePriced = new Map<string, PricedEntry>();
  const afterPriced = new Map<string, PricedEntry>();
  const beforeUsage = new Map<string, UsageEntry>();
  const afterUsage = new Map<string, UsageEntry>();

  for (const stack of before.stacks) {
    for (const r of stack.resources) {
      beforePriced.set(`${stack.stackId}::${r.logicalId}`, {
        stackId: stack.stackId,
        logicalId: r.logicalId,
        type: r.type,
        monthlyCost: r.monthlyCost,
      });
    }
    for (const r of stack.usageBasedResources) {
      beforeUsage.set(`${stack.stackId}::${r.logicalId}`, {
        stackId: stack.stackId,
        logicalId: r.logicalId,
        type: r.type,
        unitPrice: r.unitPrice,
      });
    }
  }

  for (const stack of after.stacks) {
    for (const r of stack.resources) {
      afterPriced.set(`${stack.stackId}::${r.logicalId}`, {
        stackId: stack.stackId,
        logicalId: r.logicalId,
        type: r.type,
        monthlyCost: r.monthlyCost,
      });
    }
    for (const r of stack.usageBasedResources) {
      afterUsage.set(`${stack.stackId}::${r.logicalId}`, {
        stackId: stack.stackId,
        logicalId: r.logicalId,
        type: r.type,
        unitPrice: r.unitPrice,
      });
    }
  }

  const resources: ResourceDiff[] = [];
  const allPricedKeys = new Set([...beforePriced.keys(), ...afterPriced.keys()]);

  for (const key of allPricedKeys) {
    const b = beforePriced.get(key);
    const a = afterPriced.get(key);
    let kind: ResourceChangeKind;
    let beforeCost: number | null = null;
    let afterCost: number | null = null;
    let delta: number | null = null;
    let deltaPercent: number | null = null;

    if (b !== undefined && a === undefined) {
      kind = 'removed';
      beforeCost = b.monthlyCost;
      delta = -b.monthlyCost;
      if (beforeCost !== 0) {
        deltaPercent = (delta / beforeCost) * 100;
      }
    } else if (b === undefined && a !== undefined) {
      kind = 'added';
      afterCost = a.monthlyCost;
      delta = a.monthlyCost;
    } else if (b !== undefined && a !== undefined) {
      beforeCost = b.monthlyCost;
      afterCost = a.monthlyCost;
      delta = afterCost - beforeCost;
      if (beforeCost !== 0) {
        deltaPercent = (delta / beforeCost) * 100;
      }
      kind = delta !== 0 ? 'changed' : 'unchanged';
    } else {
      continue;
    }

    const rep = b ?? a!;
    resources.push({
      logicalId: rep.logicalId,
      stackId: rep.stackId,
      type: rep.type,
      kind,
      beforeCost,
      afterCost,
      delta,
      deltaPercent,
    });
  }

  const usageBasedResources: UsageBasedDiff[] = [];
  const allUsageKeys = new Set([...beforeUsage.keys(), ...afterUsage.keys()]);

  for (const key of allUsageKeys) {
    const b = beforeUsage.get(key);
    const a = afterUsage.get(key);
    let kind: ResourceChangeKind;
    let beforeUnitPrice: number | null = null;
    let afterUnitPrice: number | null = null;

    if (b !== undefined && a === undefined) {
      kind = 'removed';
      beforeUnitPrice = b.unitPrice;
    } else if (b === undefined && a !== undefined) {
      kind = 'added';
      afterUnitPrice = a.unitPrice;
    } else if (b !== undefined && a !== undefined) {
      beforeUnitPrice = b.unitPrice;
      afterUnitPrice = a.unitPrice;
      kind = b.unitPrice !== a.unitPrice ? 'changed' : 'unchanged';
    } else {
      continue;
    }

    const rep = b ?? a!;
    usageBasedResources.push({
      logicalId: rep.logicalId,
      stackId: rep.stackId,
      type: rep.type,
      kind,
      beforeUnitPrice,
      afterUnitPrice,
    });
  }

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  for (const r of resources) {
    if (r.kind === 'added') added++;
    else if (r.kind === 'removed') removed++;
    else if (r.kind === 'changed') changed++;
    else unchanged++;
  }

  const beforeTotal = before.totalMonthlyCost;
  const afterTotal = after.totalMonthlyCost;
  const totalDelta = afterTotal - beforeTotal;
  const totalDeltaPercent = beforeTotal !== 0 ? (totalDelta / beforeTotal) * 100 : null;

  const summary: DiffSummary = {
    added,
    removed,
    changed,
    unchanged,
    beforeTotal,
    afterTotal,
    delta: totalDelta,
    deltaPercent: totalDeltaPercent,
  };

  return {
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    beforeFile,
    afterFile,
    resources,
    usageBasedResources,
    summary,
  };
}

export function formatDiffTable(diff: DiffResult, noColor: boolean): string {
  if (noColor) {
    chalk.level = 0;
  } else {
    chalk.level = 3;
  }

  const lines: string[] = [];
  lines.push(`Comparing: ${diff.beforeFile} → ${diff.afterFile}`);
  lines.push('');

  const headStyle = noColor ? [] : ['cyan'];
  const table = new Table({
    head: ['Resource ID', 'Stack', 'Type', 'Before', 'After', 'Delta'],
    style: { head: headStyle },
  });

  const sortOrder: Record<ResourceChangeKind, number> = {
    removed: 0,
    changed: 1,
    added: 2,
    unchanged: 3,
  };

  const visibleResources = diff.resources.filter((r) => r.kind !== 'unchanged');
  const sorted = [...visibleResources].sort((a, b) => sortOrder[a.kind] - sortOrder[b.kind]);

  for (const r of sorted) {
    const beforeStr = r.beforeCost !== null ? formatCost(r.beforeCost) : '-';
    const afterStr = r.afterCost !== null ? formatCost(r.afterCost) : '-';
    const deltaStr = r.delta !== null ? formatDelta(r.delta, r.deltaPercent) : '-';
    let cells: string[] = [r.logicalId, r.stackId, r.type, beforeStr, afterStr, deltaStr];

    if (!noColor) {
      const colorFn =
        r.kind === 'added' ? chalk.green : r.kind === 'removed' ? chalk.red : chalk.yellow;
      cells = cells.map((c) => colorFn(c));
    }

    table.push(cells);
  }

  const totalLabel = noColor ? 'Total' : chalk.bold('Total');
  const totalDeltaStr = formatDelta(diff.summary.delta, diff.summary.deltaPercent);
  table.push([
    totalLabel,
    '',
    '',
    formatCost(diff.summary.beforeTotal),
    formatCost(diff.summary.afterTotal),
    totalDeltaStr,
  ]);

  lines.push(table.toString());

  const unchangedResources = diff.resources.filter((r) => r.kind === 'unchanged');
  if (unchangedResources.length > 0) {
    const names = unchangedResources
      .map((r) => `${r.type.split('::')[1]} ${r.logicalId}`)
      .join(', ');
    lines.push(`Unchanged (${unchangedResources.length}): ${names}`);
  }

  if (diff.usageBasedResources.length > 0) {
    lines.push('Usage-based changes:');
    for (const r of diff.usageBasedResources) {
      const beforeStr = r.beforeUnitPrice !== null ? formatUnitPrice(r.beforeUnitPrice) : '-';
      const afterStr = r.afterUnitPrice !== null ? formatUnitPrice(r.afterUnitPrice) : '-';
      lines.push(`  ${r.logicalId}: ${beforeStr} → ${afterStr} (${r.kind})`);
    }
  }

  return lines.join('\n');
}

export function formatDiffJson(diff: DiffResult): string {
  return JSON.stringify(diff, null, 2);
}

export function formatDiffSummary(diff: DiffResult): string {
  const { delta, deltaPercent, added, removed, changed, unchanged } = diff.summary;
  const prefix = delta >= 0 ? '+' : '-';
  const costStr = `${prefix}$${Math.abs(delta).toFixed(2)}/month`;
  const pctPart =
    deltaPercent !== null
      ? ` (${deltaPercent >= 0 ? '+' : '-'}${Math.round(Math.abs(deltaPercent))}%)`
      : '';
  return `${costStr}${pctPart} · ${added} added · ${removed} removed · ${changed} changed · ${unchanged} unchanged`;
}
