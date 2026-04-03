import * as fs from 'node:fs';
import * as path from 'node:path';
import envPaths from 'env-paths';
import type { PricingQuery, PricingApiResult, CacheEntry } from './types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Layer 1: In-Memory Cache ─────────────────────────────────────────────────

const memoryCache = new Map<string, PricingApiResult>();

// ─── Cache Key ────────────────────────────────────────────────────────────────

/**
 * Builds a deterministic cache key from a pricing query and region.
 * Filters are sorted by field name so the key is stable regardless of
 * the order in which filters are supplied.
 *
 * Format: "{region}:{serviceCode}:{field=value,...}"
 * Example: "us-east-1:AmazonEC2:instanceType=m5.large,location=US East (N. Virginia)"
 */
export function buildCacheKey(query: PricingQuery, region: string): string {
  const sortedPairs = [...query.filters]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((f) => `${f.field}=${f.value}`)
    .join(',');
  return `${region}:${query.serviceCode}:${sortedPairs}`;
}

// ─── Memory Cache API ─────────────────────────────────────────────────────────

export function getFromMemory(key: string): PricingApiResult | null {
  return memoryCache.get(key) ?? null;
}

export function setInMemory(key: string, result: PricingApiResult): void {
  memoryCache.set(key, result);
}

/** Clears the in-memory cache — used when --no-cache flag is set. */
export function clearMemory(): void {
  memoryCache.clear();
}

// ─── TTL ──────────────────────────────────────────────────────────────────────

export function isExpired(entry: CacheEntry): boolean {
  return Date.now() > entry.cachedAt + entry.ttlMs;
}

// ─── Layer 2: File Cache ──────────────────────────────────────────────────────

interface FileCacheContent {
  version: string;
  entries: Record<string, unknown>;
}

function getCacheFilePath(region: string): string {
  const cacheDir = envPaths('stackprice').cache;
  return path.join(cacheDir, `pricing-${region}.json`);
}

function readFileCacheContent(region: string): FileCacheContent {
  const filePath = getCacheFilePath(region);

  if (!fs.existsSync(filePath)) {
    return { version: '1', entries: {} };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { version: '1', entries: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: '1', entries: {} };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>)['version'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['entries'] !== 'object' ||
    (parsed as Record<string, unknown>)['entries'] === null
  ) {
    return { version: '1', entries: {} };
  }

  return parsed as FileCacheContent;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['cachedAt'] === 'number' &&
    typeof v['ttlMs'] === 'number' &&
    typeof v['result'] === 'object' &&
    v['result'] !== null
  );
}

export function getFromFile(key: string, region: string): PricingApiResult | null {
  const content = readFileCacheContent(region);
  const raw = content.entries[key];

  if (!isCacheEntry(raw)) return null;
  if (isExpired(raw)) return null;

  // Promote to memory layer on hit.
  setInMemory(key, raw.result);
  return raw.result;
}

export function setInFile(key: string, region: string, result: PricingApiResult): void {
  const content = readFileCacheContent(region);

  const entry: CacheEntry = {
    query: { serviceCode: '', filters: [] },
    result,
    cachedAt: Date.now(),
    ttlMs: TTL_MS,
  };

  content.entries[key] = entry;

  const filePath = getCacheFilePath(region);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
}
