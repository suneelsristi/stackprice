import * as fs from 'fs';
import * as path from 'path';
import { load } from 'js-yaml';
import { StackPriceError } from '../errors/index.js';
import type { UsageFile, ResourceUsage, EstimatedResource, UsageBasedResource } from './types.js';

export function parseUsageFile(filePath: string): UsageFile {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();

  if (ext !== '.yml' && ext !== '.yaml' && ext !== '.json') {
    throw new StackPriceError(
      `--usage-file must be a .yml, .yaml, or .json file. Got: ${path.extname(resolved)}`,
      2,
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new StackPriceError(`Usage file not found: ${filePath}`, 2);
  }

  let content: string;
  try {
    content = fs.readFileSync(resolved, 'utf-8') as string;
  } catch {
    throw new StackPriceError(`Failed to read usage file: ${filePath}`, 2);
  }

  let parsed: unknown;
  if (ext === '.json') {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new StackPriceError(`Invalid JSON in usage file: ${filePath}`, 2);
    }
  } else {
    try {
      parsed = load(content);
    } catch {
      throw new StackPriceError(`Invalid YAML in usage file: ${filePath}`, 2);
    }
  }

  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new StackPriceError(`Usage file must be a YAML mapping of resource IDs to usage values: ${filePath}`, 2);
  }

  // Validate shape: Record<string, ResourceUsage>
  const result: UsageFile = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      continue; // silently skip invalid entries
    }
    const entry = value as Record<string, unknown>;
    const usage: ResourceUsage = {};
    if (typeof entry['requests_per_month'] === 'number') {
      usage.requests_per_month = entry['requests_per_month'];
    }
    if (typeof entry['avg_duration_ms'] === 'number') {
      usage.avg_duration_ms = entry['avg_duration_ms'];
    }
    if (typeof entry['memory_mb'] === 'number') {
      usage.memory_mb = entry['memory_mb'];
    }
    if (typeof entry['storage_gb'] === 'number') {
      usage.storage_gb = entry['storage_gb'];
    }
    result[key] = usage;
  }

  return result;
}

export function calculateEstimatedCost(
  resource: UsageBasedResource,
  usage: ResourceUsage,
): EstimatedResource | null {
  try {
    const { type, logicalId, unitPrice, unit, currency } = resource;

    if (type === 'AWS::Lambda::Function') {
      const { requests_per_month, avg_duration_ms, memory_mb = 128 } = usage;
      if (requests_per_month === undefined || avg_duration_ms === undefined) {
        return null;
      }
      const gbSeconds = (memory_mb / 1024) * (avg_duration_ms / 1000) * requests_per_month;
      const estimatedMonthlyCost = gbSeconds * unitPrice;
      const basis = `${(requests_per_month / 1e6).toFixed(0)}M req × ${avg_duration_ms}ms × ${memory_mb}MB`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::S3::Bucket') {
      const { storage_gb } = usage;
      if (storage_gb === undefined) {
        return null;
      }
      const estimatedMonthlyCost = storage_gb * unitPrice;
      const basis = `${storage_gb}GB stored`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::SQS::Queue') {
      const { requests_per_month } = usage;
      if (requests_per_month === undefined) {
        return null;
      }
      const estimatedMonthlyCost = requests_per_month * unitPrice;
      const basis = `${requests_per_month.toLocaleString()} requests`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::SNS::Topic') {
      const { requests_per_month } = usage;
      if (requests_per_month === undefined) {
        return null;
      }
      const estimatedMonthlyCost = requests_per_month * unitPrice;
      const basis = `${requests_per_month.toLocaleString()} notifications`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::ApiGateway::RestApi') {
      const { requests_per_month } = usage;
      if (requests_per_month === undefined) {
        return null;
      }
      const estimatedMonthlyCost = requests_per_month * unitPrice;
      const basis = `${requests_per_month.toLocaleString()} requests`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    return null;
  } catch {
    return null;
  }
}
