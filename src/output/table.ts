import Table from 'cli-table3';
import chalk from 'chalk';
import type { PricedStack } from '../pricing/types.js';
import { stripCdkHash } from '../utils/string.js';

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
    table.push([stripCdkHash(r.logicalId), r.type, formatCost(r.monthlyCost)]);
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

  const sorted = [...stack.usageBasedResources].sort((a, b) => b.unitPrice - a.unitPrice);
  for (const r of sorted) {
    table.push([stripCdkHash(r.logicalId), r.type, `${formatUnitPrice(r.unitPrice)}/unit`, 'Usage-based — provide estimate via --usage-file']);
  }

  return table.toString();
}

function buildEstimatedTable(stack: PricedStack, noColor: boolean): string {
  const headStyle = noColor ? [] : ['cyan'];
  const table = new Table({
    head: ['Resource ID', 'Type', 'Monthly Cost', 'Basis'],
    style: { head: headStyle },
  });

  for (const r of stack.estimatedResources) {
    table.push([stripCdkHash(r.logicalId), r.type, `~${formatCost(r.estimatedMonthlyCost)}`, r.basis]);
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
    table.push([stripCdkHash(r.logicalId), r.type, r.conditionName, costStr]);
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
  const hasEstimated = stacks.some((s) => s.estimatedResources.length > 0);

  const lines: string[] = [];

  for (const stack of stacks) {
    const stackHeader = header(`Stack: ${stack.stackId}   Region: ${stack.region}`, noColor);
    lines.push(stackHeader);

    let firstSection = true;

    const pushHeading = (text: string): void => {
      if (!firstSection) lines.push('');
      lines.push(chalk.bold(text));
      firstSection = false;
    };

    if (stack.pricedResources.length > 0) {
      pushHeading('▸ Fixed monthly costs');
      lines.push(buildFixedTable(stack, noColor));
    }

    if (stack.estimatedResources.length > 0) {
      pushHeading('▸ Estimated costs');
      lines.push(buildEstimatedTable(stack, noColor));
      lines.push('~ Estimated using Tier 1 pricing. Actual costs may be lower at high volume.');
    }

    if (stack.usageBasedResources.length > 0) {
      pushHeading('▸ Usage-based resources');
      lines.push(buildUsageTable(stack, noColor));
    }

    if (stack.conditionalResources.length > 0) {
      pushHeading('▸ Conditioned resources');
      lines.push(buildConditionalTable(stack, noColor));
    }

    if (stack.unsupportedTypes.length > 0) {
      const label = noColor ? 'Unsupported types (not priced):' : chalk.yellow('Unsupported types (not priced):');
      lines.push(`${label} ${stack.unsupportedTypes.join(', ')}`);
    }

    lines.push('');
  }

  const totalEstimated = stacks.reduce(
    (sum, s) => sum + s.estimatedResources.reduce((s2, r) => s2 + r.estimatedMonthlyCost, 0),
    0,
  );
  const fixedCost = totalMonthlyCost - totalEstimated;
  let totalStr: string;
  if (hasEstimated && hasUsageBased) {
    totalStr = `${formatCost(fixedCost)} + ~${formatCost(totalEstimated)} estimated + usage-based`;
  } else if (hasEstimated) {
    totalStr = `${formatCost(fixedCost)} + ~${formatCost(totalEstimated)} estimated`;
  } else {
    totalStr = formatCost(totalMonthlyCost) + (hasUsageBased ? ' + usage-based' : '');
  }
  const totalLine = noColor
    ? `TOTAL ESTIMATED MONTHLY COST: ${totalStr}`
    : chalk.bold.green(`TOTAL ESTIMATED MONTHLY COST: ${totalStr}`);

  lines.push(totalLine);

  return lines.join('\n');
}
