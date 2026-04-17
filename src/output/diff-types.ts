export type ResourceChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface ResourceDiff {
  logicalId: string;
  stackId: string;
  type: string;
  kind: ResourceChangeKind;
  beforeCost: number | null;   // null if added
  afterCost: number | null;    // null if removed
  delta: number | null;        // null if usage-based
  deltaPercent: number | null; // null if beforeCost is 0 or null
}

export interface UsageBasedDiff {
  logicalId: string;
  stackId: string;
  type: string;
  kind: ResourceChangeKind;
  beforeUnitPrice: number | null;
  afterUnitPrice: number | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  beforeTotal: number;
  afterTotal: number;
  delta: number;
  deltaPercent: number | null;
}

export interface DiffResult {
  schemaVersion: '1.0';
  timestamp: string;
  beforeFile: string;
  afterFile: string;
  resources: ResourceDiff[];
  usageBasedResources: UsageBasedDiff[];
  summary: DiffSummary;
}
