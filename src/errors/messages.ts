export const NO_CREDENTIALS =
  '✗ No AWS credentials found.\n' +
  '  stackprice needs pricing:GetProducts to fetch pricing data.\n' +
  '  Fix: export AWS_ACCESS_KEY_ID=... && export AWS_SECRET_ACCESS_KEY=...\n' +
  '  Or:  aws configure\n' +
  '  Required IAM permission: pricing:GetProducts (read-only, free to call)\n' +
  '  Docs: github.com/suneelsristi/stackprice#credentials';

export function cdkV1Detected(version: string): string {
  return (
    `✗ CDK v1 cloud assembly detected (schema version: ${version}).\n` +
    '  stackprice supports CDK v2+ only.\n' +
    '  Fix: https://docs.aws.amazon.com/cdk/v2/guide/migrating-v2.html'
  );
}

export function noManifest(dir: string): string {
  return (
    `✗ No CDK cloud assembly found at: ${dir}\n` +
    `  Expected: ${dir}/manifest.json\n` +
    '  Fix: run "cdk synth" first, then point --dir at the cdk.out directory.'
  );
}

export function regionDefaulted(stackId: string): string {
  return (
    `⚠ Stack ${stackId}: region not determined. Defaulting to us-east-1.\n` +
    '  Use --region to specify a region explicitly.'
  );
}
