import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PricingQuery, PricingApiResult, CacheEntry } from '../../../src/pricing/types.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock env-paths — never resolve real OS paths in tests.
vi.mock('env-paths', () => ({
  default: vi.fn(() => ({ cache: '/mock/cache/stackprice' })),
}));

// Mock node:fs — never read/write real files in tests.
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]): unknown => mockExistsSync(...args),
  readFileSync: (...args: unknown[]): unknown => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]): unknown => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]): unknown => mockMkdirSync(...args),
}));

import {
  buildCacheKey,
  getFromMemory,
  setInMemory,
  clearMemory,
  getFromFile,
  setInFile,
  isExpired,
} from '../../../src/pricing/cache.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REGION = 'us-east-1';

const QUERY: PricingQuery = {
  serviceCode: 'AmazonEC2',
  filters: [
    { field: 'instanceType', value: 'm5.large' },
    { field: 'location', value: 'US East (N. Virginia)' },
  ],
};

const RESULT: PricingApiResult = {
  pricePerUnit: 0.096,
  unit: 'Hrs',
  currency: 'USD',
};

const NOW = new Date('2024-01-15T12:00:00Z').getTime();
const TTL_MS = 24 * 60 * 60 * 1000;

function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    query: QUERY,
    result: RESULT,
    cachedAt: NOW,
    ttlMs: TTL_MS,
    ...overrides,
  };
}

function makeFileCacheJson(entries: Record<string, CacheEntry>): string {
  return JSON.stringify({ version: '1', entries });
}

// ─── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  clearMemory();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── buildCacheKey ────────────────────────────────────────────────────────────

describe('buildCacheKey', () => {
  it('formats key as region:serviceCode:field=value pairs', () => {
    const query: PricingQuery = {
      serviceCode: 'AmazonEC2',
      filters: [{ field: 'instanceType', value: 'm5.large' }],
    };
    const key = buildCacheKey(query, 'us-east-1');
    expect(key).toBe('us-east-1:AmazonEC2:instanceType=m5.large');
  });

  it('produces the same key regardless of filter order', () => {
    const queryA: PricingQuery = {
      serviceCode: 'AmazonEC2',
      filters: [
        { field: 'instanceType', value: 'm5.large' },
        { field: 'location', value: 'US East (N. Virginia)' },
      ],
    };
    const queryB: PricingQuery = {
      serviceCode: 'AmazonEC2',
      filters: [
        { field: 'location', value: 'US East (N. Virginia)' },
        { field: 'instanceType', value: 'm5.large' },
      ],
    };
    expect(buildCacheKey(queryA, REGION)).toBe(buildCacheKey(queryB, REGION));
  });

  it('sorts filter pairs alphabetically by field name', () => {
    const query: PricingQuery = {
      serviceCode: 'AmazonRDS',
      filters: [
        { field: 'databaseEngine', value: 'MySQL' },
        { field: 'deploymentOption', value: 'Single-AZ' },
        { field: 'instanceType', value: 'db.t3.micro' },
      ],
    };
    const key = buildCacheKey(query, 'eu-west-1');
    expect(key).toBe(
      'eu-west-1:AmazonRDS:databaseEngine=MySQL,deploymentOption=Single-AZ,instanceType=db.t3.micro',
    );
  });

  it('handles empty filters', () => {
    const query: PricingQuery = { serviceCode: 'AmazonS3', filters: [] };
    const key = buildCacheKey(query, 'us-west-2');
    expect(key).toBe('us-west-2:AmazonS3:');
  });

  it('includes region in the key', () => {
    const keyA = buildCacheKey(QUERY, 'us-east-1');
    const keyB = buildCacheKey(QUERY, 'eu-west-1');
    expect(keyA).not.toBe(keyB);
    expect(keyA).toContain('us-east-1');
    expect(keyB).toContain('eu-west-1');
  });

  it('does not mutate the original filters array', () => {
    const filters = [
      { field: 'z', value: '1' },
      { field: 'a', value: '2' },
    ];
    const query: PricingQuery = { serviceCode: 'SVC', filters };
    buildCacheKey(query, REGION);
    expect(filters[0]!.field).toBe('z');
    expect(filters[1]!.field).toBe('a');
  });
});

// ─── Memory Cache ─────────────────────────────────────────────────────────────

describe('getFromMemory', () => {
  it('returns null on a cache miss', () => {
    expect(getFromMemory('no-such-key')).toBeNull();
  });

  it('returns the result after setInMemory', () => {
    setInMemory('key1', RESULT);
    expect(getFromMemory('key1')).toEqual(RESULT);
  });

  it('returns null for a different key', () => {
    setInMemory('key1', RESULT);
    expect(getFromMemory('key2')).toBeNull();
  });
});

describe('setInMemory', () => {
  it('overwrites an existing entry for the same key', () => {
    const first: PricingApiResult = { pricePerUnit: 0.1, unit: 'Hrs', currency: 'USD' };
    const second: PricingApiResult = { pricePerUnit: 0.2, unit: 'Hrs', currency: 'USD' };
    setInMemory('k', first);
    setInMemory('k', second);
    expect(getFromMemory('k')).toEqual(second);
  });
});

describe('clearMemory', () => {
  it('removes all entries from the memory cache', () => {
    setInMemory('a', RESULT);
    setInMemory('b', RESULT);
    clearMemory();
    expect(getFromMemory('a')).toBeNull();
    expect(getFromMemory('b')).toBeNull();
  });
});

// ─── isExpired ────────────────────────────────────────────────────────────────

describe('isExpired', () => {
  it('returns false when the entry is well within TTL', () => {
    const entry = makeEntry({ cachedAt: NOW, ttlMs: TTL_MS });
    vi.setSystemTime(NOW + TTL_MS / 2); // halfway through TTL
    expect(isExpired(entry)).toBe(false);
  });

  it('returns false at exactly the TTL boundary (boundary is not expired)', () => {
    const entry = makeEntry({ cachedAt: NOW, ttlMs: TTL_MS });
    vi.setSystemTime(NOW + TTL_MS); // exactly at boundary
    expect(isExpired(entry)).toBe(false);
  });

  it('returns true one millisecond past the TTL boundary', () => {
    const entry = makeEntry({ cachedAt: NOW, ttlMs: TTL_MS });
    vi.setSystemTime(NOW + TTL_MS + 1);
    expect(isExpired(entry)).toBe(true);
  });

  it('returns true for an entry far past TTL', () => {
    const entry = makeEntry({ cachedAt: NOW - TTL_MS * 3, ttlMs: TTL_MS });
    expect(isExpired(entry)).toBe(true);
  });

  it('returns false for an entry cached right now with a future TTL', () => {
    const entry = makeEntry({ cachedAt: NOW, ttlMs: 1000 });
    vi.setSystemTime(NOW + 500); // 500ms in — still valid
    expect(isExpired(entry)).toBe(false);
  });
});

// ─── File Cache — getFromFile ─────────────────────────────────────────────────

describe('getFromFile', () => {
  it('returns null when the cache file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const key = buildCacheKey(QUERY, REGION);
    expect(getFromFile(key, REGION)).toBeNull();
  });

  it('returns the result on a valid cache hit', () => {
    const key = buildCacheKey(QUERY, REGION);
    const entry = makeEntry({ cachedAt: NOW, ttlMs: TTL_MS });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [key]: entry }));

    const result = getFromFile(key, REGION);

    expect(result).toEqual(RESULT);
  });

  it('promotes a file hit to the memory cache', () => {
    const key = buildCacheKey(QUERY, REGION);
    const entry = makeEntry({ cachedAt: NOW, ttlMs: TTL_MS });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [key]: entry }));

    getFromFile(key, REGION);

    expect(getFromMemory(key)).toEqual(RESULT);
  });

  it('returns null when the key is not present in the file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({}));

    expect(getFromFile('missing-key', REGION)).toBeNull();
  });

  it('returns null for an expired entry', () => {
    const key = buildCacheKey(QUERY, REGION);
    const entry = makeEntry({ cachedAt: NOW - TTL_MS - 1, ttlMs: TTL_MS });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [key]: entry }));

    expect(getFromFile(key, REGION)).toBeNull();
  });

  it('does not promote an expired entry to memory', () => {
    const key = buildCacheKey(QUERY, REGION);
    const entry = makeEntry({ cachedAt: NOW - TTL_MS - 1, ttlMs: TTL_MS });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [key]: entry }));

    getFromFile(key, REGION);

    expect(getFromMemory(key)).toBeNull();
  });

  it('returns null when the file contains invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid { json }');

    expect(getFromFile('any-key', REGION)).toBeNull();
  });

  it('returns null when the file JSON has the wrong shape (missing entries)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1' }));

    expect(getFromFile('any-key', REGION)).toBeNull();
  });

  it('returns null when the file JSON has entries: null', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1', entries: null }));

    expect(getFromFile('any-key', REGION)).toBeNull();
  });

  it('returns null when the entry is present but malformed (missing cachedAt)', () => {
    const key = 'k';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ version: '1', entries: { [key]: { result: RESULT, ttlMs: TTL_MS } } }),
    );

    expect(getFromFile(key, REGION)).toBeNull();
  });

  it('returns null when the file read throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(getFromFile('any-key', REGION)).toBeNull();
  });

  it('uses the correct file path based on region', () => {
    mockExistsSync.mockReturnValue(false);
    getFromFile('any-key', 'ap-southeast-1');

    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('pricing-ap-southeast-1.json'),
    );
  });
});

// ─── File Cache — setInFile ───────────────────────────────────────────────────

describe('setInFile', () => {
  it('writes a new file when none exists', () => {
    const key = buildCacheKey(QUERY, REGION);
    mockExistsSync.mockReturnValue(false);

    setInFile(key, REGION, RESULT);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(written) as { version: string; entries: Record<string, CacheEntry> };
    expect(parsed.version).toBe('1');
    expect(parsed.entries[key]?.result).toEqual(RESULT);
    expect(parsed.entries[key]?.cachedAt).toBe(NOW);
    expect(parsed.entries[key]?.ttlMs).toBe(TTL_MS);
  });

  it('merges with an existing file cache', () => {
    const existingKey = 'existing-key';
    const existingEntry = makeEntry();
    const newKey = buildCacheKey(QUERY, REGION);

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [existingKey]: existingEntry }));

    setInFile(newKey, REGION, RESULT);

    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(written) as { entries: Record<string, unknown> };
    expect(parsed.entries[existingKey]).toBeDefined();
    expect(parsed.entries[newKey]).toBeDefined();
  });

  it('creates the cache directory if it does not exist', () => {
    const key = buildCacheKey(QUERY, REGION);
    // file does not exist, dir does not exist
    mockExistsSync.mockReturnValue(false);

    setInFile(key, REGION, RESULT);

    expect(mockMkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it('does not call mkdirSync when the directory already exists', () => {
    const key = buildCacheKey(QUERY, REGION);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({}));

    setInFile(key, REGION, RESULT);

    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it('overwrites an existing entry for the same key', () => {
    const key = buildCacheKey(QUERY, REGION);
    const oldEntry = makeEntry({ result: { pricePerUnit: 0.01, unit: 'Hrs', currency: 'USD' } });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeFileCacheJson({ [key]: oldEntry }));

    const newResult: PricingApiResult = { pricePerUnit: 0.02, unit: 'Hrs', currency: 'USD' };
    setInFile(key, REGION, newResult);

    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(written) as { entries: Record<string, CacheEntry> };
    expect(parsed.entries[key]?.result.pricePerUnit).toBe(0.02);
  });

  it('writes to the correct file path for the given region', () => {
    const key = 'k';
    mockExistsSync.mockReturnValue(false);

    setInFile(key, 'ca-central-1', RESULT);

    const [writtenPath] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(writtenPath).toContain('pricing-ca-central-1.json');
  });

  it('sets cachedAt to the current time', () => {
    const key = buildCacheKey(QUERY, REGION);
    mockExistsSync.mockReturnValue(false);

    setInFile(key, REGION, RESULT);

    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(written) as { entries: Record<string, CacheEntry> };
    expect(parsed.entries[key]?.cachedAt).toBe(NOW);
  });

  it('sets ttlMs to 24 hours', () => {
    const key = buildCacheKey(QUERY, REGION);
    mockExistsSync.mockReturnValue(false);

    setInFile(key, REGION, RESULT);

    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(written) as { entries: Record<string, CacheEntry> };
    expect(parsed.entries[key]?.ttlMs).toBe(24 * 60 * 60 * 1000);
  });
});
