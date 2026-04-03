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

  const firstDim = (priceDimensions as Record<string, unknown>)[dimKeys[0]!];
  if (typeof firstDim !== 'object' || firstDim === null) return null;

  const dimObj = firstDim as Record<string, unknown>;
  const unit = dimObj['unit'];
  const pricePerUnitMap = dimObj['pricePerUnit'];

  if (typeof unit !== 'string') return null;
  if (typeof pricePerUnitMap !== 'object' || pricePerUnitMap === null) return null;

  const priceMap = pricePerUnitMap as Record<string, unknown>;

  // Prefer USD; fall back to the first available currency.
  const usdValue = priceMap['USD'];
  if (typeof usdValue === 'string') {
    const price = parseFloat(usdValue);
    if (isNaN(price)) return null;
    return { pricePerUnit: price, unit, currency: 'USD' };
  }

  const currencies = Object.keys(priceMap);
  if (currencies.length === 0) return null;

  const firstCurrency = currencies[0]!;
  const firstValue = priceMap[firstCurrency];
  if (typeof firstValue !== 'string') return null;

  const price = parseFloat(firstValue);
  if (isNaN(price)) return null;
  return { pricePerUnit: price, unit, currency: firstCurrency };
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
