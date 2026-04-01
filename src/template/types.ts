// ─── CloudFormation template types (raw JSON shape) ──────────────────────────

export interface CfnTemplate {
  Resources: Record<string, CfnResource>;
  Conditions?: Record<string, unknown>;
  Parameters?: Record<string, CfnParameter>;
}

export interface CfnResource {
  Type: string;
  Properties: Record<string, unknown>;
  Condition?: string;
}

export interface CfnParameter {
  Type: string;
  Default?: unknown;
}

// ─── Stage 3 output types (ParsedStack[]) ─────────────────────────────────────

export type RegionSource =
  | 'template'
  | 'flag'
  | 'AWS_DEFAULT_REGION'
  | 'AWS_REGION'
  | 'profile'
  | 'default-fallback';

export interface ResourceRecord {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface ConditionalResourceRecord extends ResourceRecord {
  conditionName: string;
}

export interface ParsedStack {
  stackId: string;
  region: string;
  regionSource: RegionSource;
  resources: ResourceRecord[];
  conditionalResources: ConditionalResourceRecord[];
  /**
   * Resource type strings that could not be priced.
   * Populated by the Pricing Engine (Stage 4), not the Template Parser.
   * Template Parser always returns this as an empty array.
   */
  unsupportedTypes: string[];
}
