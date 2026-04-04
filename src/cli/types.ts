export interface CliOptions {
  dir: string;
  template?: string;
  stack?: string;
  region?: string;
  output: 'table' | 'json' | 'summary';
  outFile?: string;
  noColor: boolean;
  verbose: boolean;
  noCache: boolean;
}
