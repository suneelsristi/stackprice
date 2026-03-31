export interface CloudAssembly {
  version: string;
  stacks: StackManifest[];
}

export interface StackManifest {
  id: string;
  templateFile: string;
  environment: StackEnvironment;
}

export interface StackEnvironment {
  account: string; // AWS account ID or "unknown-account"
  region: string; // AWS region or "unknown-region"
}
