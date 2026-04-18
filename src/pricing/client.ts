import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { StackPriceError, EXIT_CODES } from '../errors/index.js';
import type { PricingQuery, PricingApiResult } from './types.js';

// ─── Price Extraction ─────────────────────────────────────────────────────────

/**
 * Navigates the AWS Pricing API response JSON to extract the first OnDemand
 * price dimension.
 *
 * Response shape:
 * {
 *   terms: {
 *     OnDemand: {
 *       "<offerTermCode>": {
 *         priceDimensions: {
 *           "<ratecode>": {
 *             pricePerUnit: { "USD": "0.0100" },
 *             unit: "Hrs"
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 *
 * Security Rule 4: never includes raw API response bodies in errors.
 * Security Rule 5: all accesses type-guarded before property reads.
 */
function extractPriceFromItem(item: unknown): PricingApiResult | null {
  if (typeof item !== 'object' || item === null) return null;

  const terms = (item as Record<string, unknown>)['terms'];
  if (typeof terms !== 'object' || terms === null) return null;

  const onDemand = (terms as Record<string, unknown>)['OnDemand'];
  if (typeof onDemand !== 'object' || onDemand === null) return null;

  const offerTermKeys = Object.keys(onDemand as Record<string, unknown>);
  if (offerTermKeys.length === 0) return null;

  const firstOfferTerm = (onDemand as Record<string, unknown>)[offerTermKeys[0]!];
  if (typeof firstOfferTerm !== 'object' || firstOfferTerm === null) return null;

  const priceDimensions = (firstOfferTerm as Record<string, unknown>)['priceDimensions'];
  if (typeof priceDimensions !== 'object' || priceDimensions === null) return null;

  const dimKeys = Object.keys(priceDimensions as Record<string, unknown>);
  if (dimKeys.length === 0) return null;

  // Collect all parseable dimensions; prefer the first non-zero price so that
  // free-tier $0 dimensions (e.g. DynamoDB first-25-RCU) never shadow the
  // real paid-tier price.
  interface ParsedDim {
    price: number;
    unit: string;
    currency: string;
    beginRange?: string | number;
  }
  const candidates: ParsedDim[] = [];

  for (const key of dimKeys) {
    const dim = (priceDimensions as Record<string, unknown>)[key];
    if (typeof dim !== 'object' || dim === null) continue;

    const dimObj = dim as Record<string, unknown>;
    const unit = dimObj['unit'];
    const pricePerUnitMap = dimObj['pricePerUnit'];
    const beginRange = dimObj['beginRange'];

    if (typeof unit !== 'string') continue;
    if (typeof pricePerUnitMap !== 'object' || pricePerUnitMap === null) continue;

    const priceMap = pricePerUnitMap as Record<string, unknown>;

    // Prefer USD; fall back to the first available currency.
    let price: number | undefined;
    let currency: string | undefined;

    const usdValue = priceMap['USD'];
    if (typeof usdValue === 'string') {
      const parsed = parseFloat(usdValue);
      if (!isNaN(parsed)) {
        price = parsed;
        currency = 'USD';
      }
    } else {
      const currencies = Object.keys(priceMap);
      if (currencies.length > 0) {
        const firstCurrency = currencies[0]!;
        const firstValue = priceMap[firstCurrency];
        if (typeof firstValue === 'string') {
          const parsed = parseFloat(firstValue);
          if (!isNaN(parsed)) {
            price = parsed;
            currency = firstCurrency;
          }
        }
      }
    }

    if (price !== undefined && currency !== undefined) {
      const entry: ParsedDim = { price, unit, currency };
      if (typeof beginRange === 'string' || typeof beginRange === 'number') {
        entry.beginRange = beginRange;
      }
      candidates.push(entry);
    }
  }

  if (candidates.length === 0) return null;

  // For tiered pricing (e.g. API Gateway), prefer the Tier 1 dimension
  // (beginRange === 0) which is the standard first-tier rate. Fall back to
  // the first non-zero candidate for services with no beginRange field.
  // Only fall back to zero if every dimension has pricePerUnit === 0
  // (e.g. genuinely free resources).
  const tier1 = candidates.find(
    (c) => (c.beginRange === '0' || c.beginRange === 0) && c.price !== 0,
  );
  const nonZero = candidates.find((c) => c.price !== 0);
  const chosen = tier1 ?? nonZero ?? candidates[0]!;
  return { pricePerUnit: chosen.price, unit: chosen.unit, currency: chosen.currency };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the first matching OnDemand price for the given query from the
 * AWS Price List API.
 *
 * @param query   Service code and TERM_MATCH filters describing the resource.
 * @param region  AWS region used to initialise the Pricing API client.
 *                The Pricing API endpoint itself is global (us-east-1); pass
 *                us-east-1 from the pricing engine for production use.
 * @returns PricingApiResult when a match is found, null when no products match.
 * @throws StackPriceError  on genuine API failures (network, auth, throttling).
 *
 * Security Rule 3: credentials are never logged or included in error messages.
 * Security Rule 4: API response bodies are never included in error messages.
 */
export async function fetchPrice(
  query: PricingQuery,
  region: string,
): Promise<PricingApiResult | null> {
  const client = new PricingClient({ region });

  const filters = query.filters.map((f) => ({
    Type: 'TERM_MATCH' as const,
    Field: f.field,
    Value: f.value,
  }));

  let priceList: string[];
  try {
    const command = new GetProductsCommand({
      ServiceCode: query.serviceCode,
      Filters: filters,
    });
    const response = await client.send(command);
    priceList = response.PriceList ?? [];
  } catch {
    const hint =
      'Ensure pricing:GetProducts permission is granted to your IAM principal.';
    throw new StackPriceError(
      `Pricing API request failed for service: ${query.serviceCode}`,
      EXIT_CODES.FAILURE,
      hint,
    );
  }

  if (priceList.length === 0) {
    return null;
  }

  const firstItem = priceList[0]!;
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstItem);
  } catch {
    throw new StackPriceError(
      `Failed to parse pricing response for service: ${query.serviceCode}`,
      EXIT_CODES.FAILURE,
    );
  }

  return extractPriceFromItem(parsed);
}
