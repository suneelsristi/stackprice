import * as fs from 'fs';
import * as path from 'path';

import { EXIT_CODES, StackPriceError } from '../errors/index.js';
import { readAssembly } from '../assembly/reader.js';

// ─── Type map (short name → CloudFormation type) ──────────────────────────────

export const TYPE_MAP: Record<string, string> = {
  Lambda:       'AWS::Lambda::Function',
  S3:           'AWS::S3::Bucket',
  SQS:          'AWS::SQS::Queue',
  SNS:          'AWS::SNS::Topic',
  ApiGateway:   'AWS::ApiGateway::RestApi',
  NatGateway:   'AWS::EC2::NatGateway',
  CloudFront:   'AWS::CloudFront::Distribution',
  LogsLogGroup:           'AWS::Logs::LogGroup',
  FirehoseDeliveryStream: 'AWS::KinesisFirehose::DeliveryStream',
  StepFunctions:          'AWS::StepFunctions::StateMachine',
};

// Handlers registered as pricingType: 'usage-based' or 'mixed' in the registry
const REGISTERED_USAGE_BASED_TYPES = new Set([
  'AWS::Lambda::Function',
  'AWS::S3::Bucket',
  'AWS::SQS::Queue',
  'AWS::SNS::Topic',
  'AWS::ApiGateway::RestApi',
  'AWS::EC2::NatGateway',
  'AWS::CloudFront::Distribution',
  'AWS::Logs::LogGroup',
  'AWS::KinesisFirehose::DeliveryStream',
  'AWS::StepFunctions::StateMachine',
]);

// Not yet registered but planned — include anyway for future-proofing
const UPCOMING_USAGE_BASED_TYPES = new Set<string>();

const ALL_USAGE_BASED_TYPES = new Set([
  ...REGISTERED_USAGE_BASED_TYPES,
  ...UPCOMING_USAGE_BASED_TYPES,
]);

// Canonical output order for grouped YAML/JSON sections
const TYPE_ORDER = [
  'AWS::Lambda::Function',
  'AWS::S3::Bucket',
  'AWS::SQS::Queue',
  'AWS::SNS::Topic',
  'AWS::ApiGateway::RestApi',
  'AWS::EC2::NatGateway',
  'AWS::CloudFront::Distribution',
  'AWS::Logs::LogGroup',
  'AWS::KinesisFirehose::DeliveryStream',
  'AWS::StepFunctions::StateMachine',
];

// ─── Exported interfaces ──────────────────────────────────────────────────────

export interface GenerateOptions {
  dir: string;
  stack?: string;
  format: 'yaml' | 'json';
  outFile: string;
  force: boolean;
  types: string[];
}

export interface UsageResource {
  logicalId: string;
  type: string;
  stackId: string;
  properties: Record<string, unknown>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function readTemplateResources(
  templatePath: string,
): Array<{ logicalId: string; type: string; properties: Record<string, unknown> }> {
  let raw: string;
  try {
    raw = fs.readFileSync(templatePath, 'utf-8') as string;
  } catch {
    throw new StackPriceError(
      `Cannot read template file: ${path.basename(templatePath)}`,
      EXIT_CODES.FAILURE,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StackPriceError(
      `Template is not valid JSON: ${path.basename(templatePath)}`,
      EXIT_CODES.FAILURE,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const templateObj = parsed as Record<string, unknown>;
  const rawResources = Object.prototype.hasOwnProperty.call(templateObj, 'Resources')
    ? templateObj['Resources']
    : undefined;

  if (
    typeof rawResources !== 'object' ||
    rawResources === null ||
    Array.isArray(rawResources)
  ) {
    return [];
  }

  const resourcesObj = rawResources as Record<string, unknown>;
  const resources: Array<{ logicalId: string; type: string; properties: Record<string, unknown> }> = [];

  for (const logicalId of Object.keys(resourcesObj)) {
    const entry: unknown = resourcesObj[logicalId];
    if (typeof entry !== 'object' || entry === null) continue;

    const entryObj = entry as Record<string, unknown>;
    const type = Object.prototype.hasOwnProperty.call(entryObj, 'Type')
      ? entryObj['Type']
      : undefined;
    if (typeof type !== 'string') continue;

    const rawProps = Object.prototype.hasOwnProperty.call(entryObj, 'Properties')
      ? entryObj['Properties']
      : undefined;
    const properties: Record<string, unknown> =
      typeof rawProps === 'object' && rawProps !== null && !Array.isArray(rawProps)
        ? (rawProps as Record<string, unknown>)
        : {};

    resources.push({ logicalId, type, properties });
  }

  return resources;
}

// ─── YAML generation helpers ──────────────────────────────────────────────────

// Pad key-value string to column 31, then append `# comment`
function commentLine(keyValue: string, comment: string): string {
  return `${keyValue.padEnd(31)}# ${comment}`;
}

// Build a 56-char wide type separator using box-drawing characters
function typeSeparator(type: string): string {
  const prefix = `# ── ${type} `;
  const remaining = Math.max(0, 56 - prefix.length);
  return prefix + '─'.repeat(remaining);
}

function lambdaYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const commentParts: string[] = [];

  const funcName = properties['FunctionName'];
  if (typeof funcName === 'string') {
    commentParts.push(`Name: ${funcName}`);
  }
  const runtime = properties['Runtime'];
  if (typeof runtime === 'string') {
    commentParts.push(`Runtime: ${runtime}`);
  }
  const timeout = properties['Timeout'];
  const timeoutS = typeof timeout === 'number' ? timeout : undefined;
  if (timeoutS !== undefined) {
    commentParts.push(`Timeout: ${timeoutS}s`);
  }

  if (commentParts.length > 0) {
    lines.push(`# ${commentParts.join(' | ')}`);
  }

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  requests_per_month: 0', 'TODO: monthly invocations'));

  const maxMs = timeoutS !== undefined ? ` (max: ${timeoutS * 1000}ms)` : '';
  lines.push(commentLine('  avg_duration_ms: 0', `TODO: average execution time in ms${maxMs}`));

  const memorySize = properties['MemorySize'];
  const memoryMb = typeof memorySize === 'number' ? memorySize : 128;
  lines.push(commentLine(`  memory_mb: ${memoryMb}`, 'pre-filled from CDK template'));

  return lines;
}

function s3YamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const bucketName = properties['BucketName'];
  if (typeof bucketName === 'string') {
    lines.push(`# Name: ${bucketName}`);
  }

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  storage_gb: 0', 'TODO: average GB stored per month'));

  return lines;
}

function sqsYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const isFifo = properties['FifoQueue'] === true;
  lines.push(`# Queue type: ${isFifo ? 'FIFO' : 'Standard'}`);

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  requests_per_month: 0', 'TODO: monthly messages'));

  return lines;
}

function snsYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const topicName = properties['TopicName'];
  if (typeof topicName === 'string') {
    lines.push(`# Name: ${topicName}`);
  }

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  requests_per_month: 0', 'TODO: monthly notifications'));

  return lines;
}

function apigatewayYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const name = properties['Name'];
  if (typeof name === 'string') {
    lines.push(`# Name: ${name}`);
  }

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  requests_per_month: 0', 'TODO: monthly API calls'));

  return lines;
}

function natgatewayYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { logicalId } = resource;

  lines.push('# Fixed hourly cost ($32.85/month) included automatically');
  lines.push(`${logicalId}:`);
  lines.push(commentLine('  data_transfer_gb: 0', 'TODO: monthly GB processed'));

  return lines;
}

function cloudfrontYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { logicalId } = resource;

  lines.push('# Prices shown for US edge locations. Actual costs vary by zone.');
  lines.push(`${logicalId}:`);
  lines.push(commentLine('  monthly_requests: 0', 'TODO: monthly HTTP/HTTPS requests'));
  lines.push(commentLine('  monthly_transfer_gb: 0', 'TODO: monthly GB transferred to users'));

  return lines;
}

function cloudwatchlogsYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { logicalId } = resource;

  lines.push('# Storage rate ($0.03/GB-month) is hardcoded');
  lines.push(`${logicalId}:`);
  lines.push(commentLine('  ingestion_gb: 0', 'TODO: GB of log data ingested per month'));
  lines.push(commentLine('  storage_gb: 0', 'TODO: GB of logs stored (average)'));

  return lines;
}

function firehoseYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { logicalId } = resource;

  lines.push(`${logicalId}:`);
  lines.push(commentLine('  ingestion_gb: 0', 'TODO: GB of data ingested per month'));

  return lines;
}

function stepFunctionsYamlEntry(resource: UsageResource): string[] {
  const lines: string[] = [];
  const { properties, logicalId } = resource;

  const isExpress = properties['StateMachineType'] === 'EXPRESS';

  if (isExpress) {
    lines.push(`# AWS::StepFunctions::StateMachine (Express)`);
    lines.push(`${logicalId}:`);
    lines.push(commentLine('  monthly_requests: 0', 'TODO: workflow executions per month'));
    lines.push(commentLine('  avg_duration_ms: 0', 'TODO: average execution duration in ms'));
    lines.push(commentLine('  memory_mb: 64', 'pre-filled (Express default)'));
  } else {
    lines.push(`# AWS::StepFunctions::StateMachine (Standard)`);
    lines.push(`${logicalId}:`);
    lines.push(commentLine('  monthly_transitions: 0', 'TODO: state transitions per month'));
  }

  return lines;
}

function generateYamlEntry(resource: UsageResource): string[] {
  switch (resource.type) {
    case 'AWS::Lambda::Function':                    return lambdaYamlEntry(resource);
    case 'AWS::S3::Bucket':                          return s3YamlEntry(resource);
    case 'AWS::SQS::Queue':                          return sqsYamlEntry(resource);
    case 'AWS::SNS::Topic':                          return snsYamlEntry(resource);
    case 'AWS::ApiGateway::RestApi':                 return apigatewayYamlEntry(resource);
    case 'AWS::EC2::NatGateway':                     return natgatewayYamlEntry(resource);
    case 'AWS::CloudFront::Distribution':            return cloudfrontYamlEntry(resource);
    case 'AWS::Logs::LogGroup':                      return cloudwatchlogsYamlEntry(resource);
    case 'AWS::KinesisFirehose::DeliveryStream':     return firehoseYamlEntry(resource);
    case 'AWS::StepFunctions::StateMachine':         return stepFunctionsYamlEntry(resource);
    default:                                          return [];
  }
}

// ─── JSON entry builders ──────────────────────────────────────────────────────

function buildJsonEntry(resource: UsageResource): Record<string, unknown> {
  const entry: Record<string, unknown> = { _type: resource.type };
  const p = resource.properties;

  switch (resource.type) {
    case 'AWS::Lambda::Function': {
      const runtime = p['Runtime'];
      if (typeof runtime === 'string') entry['_runtime'] = runtime;
      const timeout = p['Timeout'];
      if (typeof timeout === 'number') entry['_timeout_ms'] = timeout * 1000;
      const memorySize = p['MemorySize'];
      entry['requests_per_month'] = 0;
      entry['avg_duration_ms'] = 0;
      entry['memory_mb'] = typeof memorySize === 'number' ? memorySize : 128;
      break;
    }
    case 'AWS::S3::Bucket': {
      entry['storage_gb'] = 0;
      break;
    }
    case 'AWS::SQS::Queue': {
      entry['_queue_type'] = p['FifoQueue'] === true ? 'FIFO' : 'Standard';
      entry['requests_per_month'] = 0;
      break;
    }
    case 'AWS::SNS::Topic': {
      entry['requests_per_month'] = 0;
      break;
    }
    case 'AWS::ApiGateway::RestApi': {
      const name = p['Name'];
      if (typeof name === 'string') entry['_name'] = name;
      entry['requests_per_month'] = 0;
      break;
    }
    case 'AWS::EC2::NatGateway': {
      entry['_note'] = 'Fixed hourly cost ($32.85/month) included automatically';
      entry['data_transfer_gb'] = 0;
      break;
    }
    case 'AWS::CloudFront::Distribution': {
      entry['_note'] = 'Prices shown for US edge locations. Actual costs vary by geographic zone.';
      entry['monthly_requests'] = 0;
      entry['monthly_transfer_gb'] = 0;
      break;
    }
    case 'AWS::Logs::LogGroup': {
      entry['_note'] = 'Storage rate ($0.03/GB-month) is hardcoded';
      entry['ingestion_gb'] = 0;
      entry['storage_gb'] = 0;
      break;
    }
    case 'AWS::KinesisFirehose::DeliveryStream': {
      entry['ingestion_gb'] = 0;
      break;
    }
    case 'AWS::StepFunctions::StateMachine': {
      const isExpress = p['StateMachineType'] === 'EXPRESS';
      if (isExpress) {
        entry['_workflow_type'] = 'Express';
        entry['monthly_requests'] = 0;
        entry['avg_duration_ms'] = 0;
        entry['memory_mb'] = 64;
      } else {
        entry['_workflow_type'] = 'Standard';
        entry['monthly_transitions'] = 0;
      }
      break;
    }
    default:
      break;
  }

  return entry;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function discoverUsageResources(
  dir: string,
  stackFilter?: string,
  typeFilter?: string[],
): UsageResource[] {
  const resolvedDir = path.resolve(dir);

  // readAssembly handles directory-not-found and invalid-assembly errors
  const assembly = readAssembly(resolvedDir);

  if (stackFilter !== undefined) {
    const found = assembly.stacks.some((s) => s.id === stackFilter);
    if (!found) {
      throw new StackPriceError(
        `Stack '${stackFilter}' not found in ${dir}.`,
        EXIT_CODES.FAILURE,
      );
    }
  }

  // Build the set of CFN types to include
  const includedCfnTypes = new Set<string>();
  if (typeFilter === undefined || typeFilter.length === 0) {
    for (const t of ALL_USAGE_BASED_TYPES) {
      includedCfnTypes.add(t);
    }
  } else {
    for (const shortName of typeFilter) {
      const cfnType = TYPE_MAP[shortName];
      if (cfnType !== undefined && ALL_USAGE_BASED_TYPES.has(cfnType)) {
        includedCfnTypes.add(cfnType);
      }
    }
  }

  const resources: UsageResource[] = [];

  for (const stackManifest of assembly.stacks) {
    if (stackFilter !== undefined && stackManifest.id !== stackFilter) continue;

    const templatePath = path.resolve(path.join(resolvedDir, stackManifest.templateFile));
    const templateResources = readTemplateResources(templatePath);

    for (const r of templateResources) {
      if (!includedCfnTypes.has(r.type)) continue;

      if (r.type === 'AWS::Lambda::Function' && r.properties['Handler'] === '__entrypoint__.handler') continue;

      resources.push({
        logicalId: r.logicalId,
        type: r.type,
        stackId: stackManifest.id,
        properties: r.properties,
      });
    }
  }

  return resources;
}

export function generateYaml(resources: UsageResource[], options: GenerateOptions): string {
  const stackDesc = options.stack !== undefined ? options.stack : 'all stacks';
  const lines: string[] = [
    '# stackprice usage estimates',
    `# Generated from: ${options.dir} (${stackDesc})`,
    '# Edit the TODO values, then run:',
    `#   stackprice breakdown --dir ${options.dir} --usage-file ${options.outFile}`,
    '#',
    '# Resources with 0 values are excluded from cost estimates.',
    '# This file was generated without AWS credentials.',
  ];

  if (resources.length === 0) {
    return lines.join('\n') + '\n';
  }

  // Group by type preserving TYPE_ORDER
  const byType = new Map<string, UsageResource[]>();
  for (const type of TYPE_ORDER) {
    byType.set(type, []);
  }
  for (const resource of resources) {
    const group = byType.get(resource.type);
    if (group !== undefined) {
      group.push(resource);
    }
  }

  for (const type of TYPE_ORDER) {
    const group = byType.get(type) ?? [];
    if (group.length === 0) continue;

    // Sort alphabetically by logicalId within each group
    const sorted = [...group].sort((a, b) => a.logicalId.localeCompare(b.logicalId));

    lines.push('');
    lines.push(typeSeparator(type));
    for (const resource of sorted) {
      lines.push(...generateYamlEntry(resource));
    }
  }

  return lines.join('\n') + '\n';
}

export function generateJson(resources: UsageResource[], options: GenerateOptions): string {
  const result: Record<string, unknown> = {
    _generated: 'stackprice generate usage-file',
    _source: options.dir,
    _instructions: `Edit the 0 values, then run: stackprice breakdown --dir ${options.dir} --usage-file ${options.outFile}`,
  };

  // Output in TYPE_ORDER for consistent ordering
  const byType = new Map<string, UsageResource[]>();
  for (const type of TYPE_ORDER) {
    byType.set(type, []);
  }
  for (const resource of resources) {
    const group = byType.get(resource.type);
    if (group !== undefined) {
      group.push(resource);
    }
  }

  for (const type of TYPE_ORDER) {
    const group = byType.get(type) ?? [];
    const sorted = [...group].sort((a, b) => a.logicalId.localeCompare(b.logicalId));
    for (const resource of sorted) {
      result[resource.logicalId] = buildJsonEntry(resource);
    }
  }

  return JSON.stringify(result, null, 2);
}

export function writeGeneratedFile(content: string, outFile: string, force: boolean): void {
  const resolved = path.resolve(outFile);

  if (!force && fs.existsSync(resolved)) {
    throw new StackPriceError(
      `${outFile} already exists. Use --force to overwrite.`,
      EXIT_CODES.FAILURE,
    );
  }

  try {
    fs.writeFileSync(resolved, content, 'utf-8');
  } catch {
    throw new StackPriceError(
      `Failed to write output file: ${outFile}`,
      EXIT_CODES.FAILURE,
    );
  }
}
