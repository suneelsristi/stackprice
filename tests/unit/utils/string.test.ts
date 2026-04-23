import { describe, it, expect } from 'vitest';
import { stripCdkHash } from '../../../src/utils/string.js';

describe('stripCdkHash', () => {
  it('strips 8-char hex suffix with letters in first 4 chars', () => {
    expect(stripCdkHash('VPCPublicSubnet1NATGatewayE0556630')).toBe('VPCPublicSubnet1NATGateway');
  });

  it('strips suffix like 99EDD300 (letter in first 4)', () => {
    expect(stripCdkHash('WebServer99EDD300')).toBe('WebServer');
  });

  it('keeps ID without any suffix unchanged', () => {
    expect(stripCdkHash('RedisCluster')).toBe('RedisCluster');
  });

  it('keeps short IDs (<=8 chars) unchanged', () => {
    expect(stripCdkHash('Short')).toBe('Short');
    expect(stripCdkHash('Exactly8')).toBe('Exactly8');
  });

  it('keeps MyApi49610EDF unchanged — first 4 chars "4961" have no A-F', () => {
    expect(stripCdkHash('MyApi49610EDF')).toBe('MyApi49610EDF');
  });

  it('keeps TaskDef54694570 unchanged — suffix "54694570" is digits only, no A-F', () => {
    expect(stripCdkHash('TaskDef54694570')).toBe('TaskDef54694570');
  });

  it('strips suffix B269D8BB (B in first 4)', () => {
    expect(stripCdkHash('DatabaseB269D8BB')).toBe('Database');
  });

  it('strips suffix CA72566A (C and A in first 4)', () => {
    expect(stripCdkHash('ProdOnlyBucketCA72566A')).toBe('ProdOnlyBucket');
  });

  it('keeps ID with lowercase hex suffix unchanged — CDK hashes are uppercase only', () => {
    expect(stripCdkHash('MyResourceabcdef12')).toBe('MyResourceabcdef12');
  });

  it('keeps ID where suffix contains non-hex characters', () => {
    expect(stripCdkHash('MyResourceZZZZZZZZ')).toBe('MyResourceZZZZZZZZ');
  });
});
