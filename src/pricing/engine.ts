import type { ParsedStack, ConditionalResourceRecord } from '../template/types.js';
import type { ResourceHandlerRegistry } from '../registry/index.js';
import type {
  PricedStack,
  PricedResource,
  UsageBasedResource,
  PricedConditionalResource,
  PricingApiResult,
  PricingQuery,
} from './types.js';
import { buildCacheKey, getFromMemory, getFromFile, setInMemory, setInFile } from './cache.js';
import { fetchPrice } from './client.js';
import type { ResourceHandler } from '../registry/handler.js';
import type { ResourceRecord } from '../template/types.js';

// ─── Internal work item ───────────────────────────────────────────────────────

interface WorkItem {
  resource: ResourceRecord | ConditionalResourceRecord;
  handler: ResourceHandler;
  query: PricingQuery;
  cacheKey: string;
  isConditional: boolean;
  /** Populated from cache before fetch phase; updated after fetch. */
  result: PricingApiResult | null;
  /** True when result came from cache (no fetch needed). */
  fromCache: boolean;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Stage 4 of the pipeline: prices every resource in every ParsedStack.
 *
 * - All fetchPrice calls for a given stack are fired via Promise.all().
 * - Cache is checked before fetching (unless noCache is true).
 * - fetchPrice returning null causes the resource to be silently skipped.
 */
export async function priceStacks(
  stacks: ParsedStack[],
  registry: ResourceHandlerRegistry,
  noCache: boolean,
): Promise<PricedStack[]> {
  const output: PricedStack[] = [];

  for (const stack of stacks) {
    const pricedResources: PricedResource[] = [];
    const usageBasedResources: UsageBasedResource[] = [];
    const conditionalResources: PricedConditionalResource[] = [];
    const unsupportedTypes: string[] = [];

    // ── Phase 1: build work items, resolve cache hits ──────────────────────────
    const workItems: WorkItem[] = [];

    const allEntries: Array<{ resource: ResourceRecord | ConditionalResourceRecord; isConditional: boolean }> = [
      ...stack.resources.map((r) => ({ resource: r, isConditional: false })),
      ...stack.conditionalResources.map((r) => ({ resource: r, isConditional: true })),
    ];

    for (const { resource, isConditional } of allEntries) {
      const handler = registry.get(resource.type);
      if (!handler) {
        if (!unsupportedTypes.includes(resource.type)) {
          unsupportedTypes.push(resource.type);
        }
        continue;
      }

      const attrs = handler.extractPricingAttributes(resource);
      if (!attrs) {
        if (!unsupportedTypes.includes(resource.type)) {
          unsupportedTypes.push(resource.type);
        }
        continue;
      }

      const query = handler.buildPricingQuery(attrs, stack.region);
      const cacheKey = buildCacheKey(query, stack.region);

      let cachedResult: PricingApiResult | null = null;
      if (!noCache) {
        cachedResult = getFromMemory(cacheKey) ?? getFromFile(cacheKey, stack.region);
      }

      workItems.push({
        resource,
        handler,
        query,
        cacheKey,
        isConditional,
        result: cachedResult,
        fromCache: cachedResult !== null,
      });
    }

    // ── Phase 2: fire all uncached fetches in parallel ─────────────────────────
    const needsFetch = workItems.filter((item) => !item.fromCache);
    const fetchedResults = await Promise.all(
      needsFetch.map((item) => fetchPrice(item.query, 'us-east-1')),
    );

    for (let i = 0; i < needsFetch.length; i++) {
      const item = needsFetch[i]!;
      const fetched = fetchedResults[i] ?? null;
      item.result = fetched;

      if (fetched !== null && !noCache) {
        setInMemory(item.cacheKey, fetched);
        setInFile(item.cacheKey, stack.region, fetched);
      }
    }

    // ── Phase 3: classify results ──────────────────────────────────────────────
    for (const item of workItems) {
      const { resource, handler, isConditional, result } = item;

      if (result === null) {
        // fetchPrice returned null — skip silently per spec.
        continue;
      }

      if (isConditional) {
        const condResource = resource as ConditionalResourceRecord;
        const condOut: PricedConditionalResource = {
          logicalId: resource.logicalId,
          type: resource.type,
          conditionName: condResource.conditionName,
          monthlyCost: null,
          currency: 'USD',
        };

        if (handler.isUsageBased) {
          condOut.unitPrice = result.pricePerUnit;
          condOut.unit = result.unit;
        } else {
          const monthlyPrice = handler.calculateMonthlyCost(result);
          if (monthlyPrice !== null) {
            condOut.monthlyCost = monthlyPrice.amount;
          }
        }

        conditionalResources.push(condOut);
      } else if (handler.isUsageBased) {
        usageBasedResources.push({
          logicalId: resource.logicalId,
          type: resource.type,
          unitPrice: result.pricePerUnit,
          unit: result.unit,
          currency: 'USD',
        });
      } else {
        const monthlyPrice = handler.calculateMonthlyCost(result);
        if (monthlyPrice !== null) {
          pricedResources.push({
            logicalId: resource.logicalId,
            type: resource.type,
            monthlyCost: monthlyPrice.amount,
            currency: 'USD',
            basis: monthlyPrice.unit,
          });
        }
      }
    }

    const stackMonthlyCost = pricedResources.reduce((sum, r) => sum + r.monthlyCost, 0);

    output.push({
      stackId: stack.stackId,
      region: stack.region,
      regionSource: stack.regionSource,
      pricedResources,
      usageBasedResources,
      conditionalResources,
      unsupportedTypes,
      stackMonthlyCost,
    });
  }

  return output;
}
