import Table from 'cli-table3';
import chalk from 'chalk';
import type { PricedStack } from '../pricing/types.js';

function formatCost(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function formatUnitPrice(price: number): string {
  if (price >= 0.01) return `$${price.toFixed(2)}`;
  if (price >= 0.0001) return `$${price.toFixed(4)}`;
  if (price >= 0.0000001) return `$${price.toFixed(7)}`;
  return `$${price.toFixed(10)}`;
}

function header(label: string, noColor: boolean): string {
  return noColor ? label : chalk.bold(label);
}

function buildFixedTable(stack: PricedStack, noColor: boolean): string {
  const sorted = [...stack.pricedResources].sort((a, b) => b.monthlyCost - a.monthlyCost);

  const headStyle = noColor ? [] : ['cyan'];
  const table = new Table({
    head: ['Resource ID', 'Type', 'Monthly Cost'],
    style: { head: headStyle },
  });

  for (const r of sorted) {
    table.push([r.logicalId, r.type, formatCost(r.monthlyCost)]);
  }

  const subtotalLabel = noColor ? 'Stack Subtotal' : chalk.bold('Stack Subtotal');
  table.push([{ content: subtotalLabel, colSpan: 2 }, formatCost(stack.stackMonthlyCost)]);

  return table.toString();
}

function buildUsageTable(stack: PricedStack, noColor: boolean): string {
  const headStyle = noColor ? [] : ['cyan'];
  const table = new Table({
    head: ['Resource ID', 'Type', 'Unit Price', 'Note'],
    style: { head: headStyle },
  });

  for (const r of stack.usageBasedResources) {
    table.push([r.logicalId, r.type, `${formatUnitPrice(r.unitPrice)}/unit`, 'Usage-based — provide estimate via --usage-file']);
  }

  return table.toString();
}

function buildConditionalTable(stack: PricedStack, noColor: boolean): string {
  const headStyle = noColor ? [] : ['cyan'];
  const table = new Table({
    head: ['Resource ID', 'Type', 'Condition', 'Monthly Cost'],
    style: { head: headStyle },
  });

  for (const r of stack.conditionalResources) {
    const costStr = r.monthlyCost !== null ? formatCost(r.monthlyCost) : 'Usage-based';
    table.push([r.logicalId, r.type, r.conditionName, costStr]);
  }

  return table.toString();
}

export function formatTable(stacks: PricedStack[], noColor: boolean): string {
  if (noColor) {
    chalk.level = 0;
  } else {
    chalk.level = 3;
  }

  const totalMonthlyCost = stacks.reduce((sum, s) => sum + s.stackMonthlyCost, 0);
  const hasUsageBased = stacks.some((s) => s.usageBasedResources.length > 0);

  const lines: string[] = [];

  for (const stack of stacks) {
    const stackHeader = header(`Stack: ${stack.stackId}   Region: ${stack.region}`, noColor);
    lines.push(stackHeader);

    if (stack.pricedResources.length > 0) {
      lines.push(buildFixedTable(stack, noColor));
    }

    if (stack.usageBasedResources.length > 0) {
      lines.push(buildUsageTable(stack, noColor));
    }

    if (stack.conditionalResources.length > 0) {
      lines.push(buildConditionalTable(stack, noColor));
    }

    if (stack.unsupportedTypes.length > 0) {
      const label = noColor ? 'Unsupported types (not priced):' : chalk.yellow('Unsupported types (not priced):');
      lines.push(`${label} ${stack.unsupportedTypes.join(', ')}`);
    }

    lines.push('');
  }

  const totalStr = formatCost(totalMonthlyCost) + (hasUsageBased ? ' + usage-based' : '');
  const totalLine = noColor
    ? `TOTAL ESTIMATED MONTHLY COST: ${totalStr}`
    : chalk.bold(`TOTAL ESTIMATED MONTHLY COST: ${totalStr}`);

  lines.push(totalLine);

  return lines.join('\n');
}
