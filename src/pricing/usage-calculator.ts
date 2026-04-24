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
    if (typeof entry['data_transfer_gb'] === 'number') {
      usage.data_transfer_gb = entry['data_transfer_gb'];
    }
    if (typeof entry['monthly_requests'] === 'number') {
      usage.monthly_requests = entry['monthly_requests'];
    }
    if (typeof entry['monthly_transfer_gb'] === 'number') {
      usage.monthly_transfer_gb = entry['monthly_transfer_gb'];
    }
    if (typeof entry['ingestion_gb'] === 'number') {
      usage.ingestion_gb = entry['ingestion_gb'];
    }
    if (typeof entry['monthly_transitions'] === 'number') {
      usage.monthly_transitions = entry['monthly_transitions'];
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

    if (type === 'AWS::EC2::NatGateway') {
      const { data_transfer_gb } = usage;
      if (data_transfer_gb === undefined || typeof data_transfer_gb !== 'number') {
        return null;
      }
      const estimatedMonthlyCost = data_transfer_gb * unitPrice;
      const basis = `${data_transfer_gb}GB processed`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::CloudFront::Distribution') {
      const { monthly_requests, monthly_transfer_gb } = usage;
      if (monthly_requests === undefined || typeof monthly_requests !== 'number') {
        return null;
      }
      if (monthly_transfer_gb === undefined || typeof monthly_transfer_gb !== 'number') {
        return null;
      }
      const CLOUDFRONT_DATA_TRANSFER_RATE = 0.085; // US zone Tier 1 rate. See docs for multi-zone pricing.
      const requests_cost = monthly_requests * unitPrice;
      const transfer_cost = monthly_transfer_gb * CLOUDFRONT_DATA_TRANSFER_RATE;
      const estimatedMonthlyCost = requests_cost + transfer_cost;
      const basis = `${monthly_requests} requests + ${monthly_transfer_gb}GB transfer (US zone)`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::KinesisFirehose::DeliveryStream') {
      const { ingestion_gb } = usage;
      if (ingestion_gb === undefined || typeof ingestion_gb !== 'number') {
        return null;
      }
      const estimatedMonthlyCost = ingestion_gb * unitPrice;
      const basis = `${ingestion_gb}GB ingested`;
      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::Logs::LogGroup') {
      const ingestion = usage.ingestion_gb ?? 0;
      const storage = usage.storage_gb ?? 0;
      if (ingestion === 0 && storage === 0) {
        return null;
      }
      // Storage rate hardcoded — verify at https://aws.amazon.com/cloudwatch/pricing/
      const CLOUDWATCH_STORAGE_RATE = 0.03;
      const ingestion_cost = ingestion * unitPrice;
      const storage_cost = storage * CLOUDWATCH_STORAGE_RATE;
      const estimatedMonthlyCost = ingestion_cost + storage_cost;

      let basis: string;
      if (ingestion > 0 && storage > 0) {
        basis = `${ingestion}GB ingested + ${storage}GB stored`;
      } else if (ingestion > 0) {
        basis = `${ingestion}GB ingested`;
      } else {
        basis = `${storage}GB stored`;
      }

      return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
    }

    if (type === 'AWS::StepFunctions::StateMachine') {
      const { monthly_transitions, monthly_requests, avg_duration_ms } = usage;

      if (monthly_transitions !== undefined) {
        // Standard workflow — charged per state transition
        const estimatedMonthlyCost = monthly_transitions * unitPrice;
        const basis = `${monthly_transitions} state transitions`;
        return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
      }

      if (monthly_requests !== undefined && avg_duration_ms !== undefined) {
        // Express workflow — charged per request + duration × memory
        const memory_mb = usage.memory_mb ?? 64;
        const gb_seconds = (memory_mb / 1024) * (avg_duration_ms / 1000) * monthly_requests;
        const request_cost = monthly_requests * unitPrice;
        const STEPFUNCTIONS_EXPRESS_DURATION_RATE = 0.0000167;
        const duration_cost = gb_seconds * STEPFUNCTIONS_EXPRESS_DURATION_RATE;
        const estimatedMonthlyCost = request_cost + duration_cost;
        const basis = `${monthly_requests} requests × ${avg_duration_ms}ms × ${memory_mb}MB`;
        return { logicalId, type, estimatedMonthlyCost, currency, basis, unitPrice, unit };
      }

      return null;
    }

    return null;
  } catch {
    return null;
  }
}
