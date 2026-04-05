import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPrice } from '../../../src/pricing/client.js';
import { StackPriceError, EXIT_CODES } from '../../../src/errors/index.js';
import type { PricingQuery } from '../../../src/pricing/types.js';

// Hoist mockSend so it is available inside the vi.mock factory (which is
// hoisted to module top-level by Vitest before any imports are resolved).
const mockSend = vi.hoisted(() => vi.fn());

// Mock the entire @aws-sdk/client-pricing module — never call the real API.
// Both PricingClient and GetProductsCommand are called with `new` in client.ts,
// so their mock implementations must be regular functions (not arrow functions).
vi.mock('@aws-sdk/client-pricing', () => ({
  PricingClient: vi.fn(function (this: { send: ReturnType<typeof vi.fn> }) {
    this.send = mockSend;
  }),
  GetProductsCommand: vi.fn(function (this: unknown, _input: unknown) {}),
}));

import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const QUERY: PricingQuery = {
  serviceCode: 'AmazonEC2',
  filters: [
    { field: 'instanceType', value: 'm5.large' },
    { field: 'operatingSystem', value: 'Linux' },
  ],
};

const REGION = 'us-east-1';

function makePriceListItem(priceUsd: string, unit = 'Hrs'): string {
  return JSON.stringify({
    product: { productFamily: 'Compute Instance' },
    terms: {
      OnDemand: {
        'OFFERTERM.RATE': {
          priceDimensions: {
            'OFFERTERM.RATE.DIM': {
              unit,
              pricePerUnit: { USD: priceUsd },
            },
          },
        },
      },
    },
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchPrice', () => {
  describe('valid query returns PricingApiResult', () => {
    it('returns pricePerUnit, unit, and currency for a matching product', async () => {
      mockSend.mockResolvedValue({ PriceList: [makePriceListItem('0.0960', 'Hrs')] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).not.toBeNull();
      expect(result!.pricePerUnit).toBeCloseTo(0.096);
      expect(result!.unit).toBe('Hrs');
      expect(result!.currency).toBe('USD');
    });

    it('parses a price of 0.0 correctly', async () => {
      mockSend.mockResolvedValue({ PriceList: [makePriceListItem('0.0', 'Hrs')] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).not.toBeNull();
      expect(result!.pricePerUnit).toBe(0);
    });

    it('skips zero-price free-tier dimension and returns the non-zero paid-tier price', async () => {
      // DynamoDB-style response: first dimension is $0 free-tier, second is paid.
      const item = JSON.stringify({
        terms: {
          OnDemand: {
            'OFFERTERM.RATE': {
              priceDimensions: {
                'OFFERTERM.RATE.FREE': {
                  unit: 'RCU-Hr',
                  pricePerUnit: { USD: '0.0000000000' },
                },
                'OFFERTERM.RATE.PAID': {
                  unit: 'RCU-Hr',
                  pricePerUnit: { USD: '0.00013000' },
                },
              },
            },
          },
        },
      });
      mockSend.mockResolvedValue({ PriceList: [item] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).not.toBeNull();
      expect(result!.pricePerUnit).toBeCloseTo(0.00013);
      expect(result!.unit).toBe('RCU-Hr');
      expect(result!.currency).toBe('USD');
    });

    it('falls back to first non-USD currency when USD is absent', async () => {
      const item = JSON.stringify({
        terms: {
          OnDemand: {
            T: {
              priceDimensions: {
                D: {
                  unit: 'GB-Mo',
                  pricePerUnit: { CNY: '0.6500' },
                },
              },
            },
          },
        },
      });
      mockSend.mockResolvedValue({ PriceList: [item] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).not.toBeNull();
      expect(result!.currency).toBe('CNY');
      expect(result!.pricePerUnit).toBeCloseTo(0.65);
    });

    it('passes the correct ServiceCode and filters to GetProductsCommand', async () => {
      mockSend.mockResolvedValue({ PriceList: [makePriceListItem('0.10')] });

      await fetchPrice(QUERY, REGION);

      const commandArg = (GetProductsCommand as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(commandArg.ServiceCode).toBe('AmazonEC2');
      expect(commandArg.Filters).toEqual([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'm5.large' },
        { Type: 'TERM_MATCH', Field: 'operatingSystem', Value: 'Linux' },
      ]);
    });

    it('initialises PricingClient with the supplied region', async () => {
      mockSend.mockResolvedValue({ PriceList: [makePriceListItem('0.10')] });

      await fetchPrice(QUERY, 'ap-south-1');

      expect(PricingClient).toHaveBeenCalledWith({ region: 'ap-south-1' });
    });
  });

  describe('no results found returns null', () => {
    it('returns null when PriceList is empty', async () => {
      mockSend.mockResolvedValue({ PriceList: [] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).toBeNull();
    });

    it('returns null when PriceList is undefined', async () => {
      mockSend.mockResolvedValue({});

      const result = await fetchPrice(QUERY, REGION);

      expect(result).toBeNull();
    });

    it('returns null when OnDemand terms are missing', async () => {
      mockSend.mockResolvedValue({ PriceList: [JSON.stringify({ terms: {} })] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).toBeNull();
    });

    it('returns null when priceDimensions is empty', async () => {
      const item = JSON.stringify({
        terms: { OnDemand: { T: { priceDimensions: {} } } },
      });
      mockSend.mockResolvedValue({ PriceList: [item] });

      const result = await fetchPrice(QUERY, REGION);

      expect(result).toBeNull();
    });
  });

  describe('API error throws StackPriceError', () => {
    it('throws StackPriceError when the API call rejects', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));

      await expect(fetchPrice(QUERY, REGION)).rejects.toThrow(StackPriceError);
    });

    it('thrown error has exit code FAILURE (2)', async () => {
      mockSend.mockRejectedValue(new Error('UnauthorizedException'));

      try {
        await fetchPrice(QUERY, REGION);
      } catch (err) {
        expect(err).toBeInstanceOf(StackPriceError);
        expect((err as StackPriceError).exitCode).toBe(EXIT_CODES.FAILURE);
      }
    });

    it('error message does not include the raw AWS SDK error body', async () => {
      const internalDetail = 'secret-api-response-body-xyz';
      mockSend.mockRejectedValue(new Error(internalDetail));

      try {
        await fetchPrice(QUERY, REGION);
      } catch (err) {
        expect((err as StackPriceError).message).not.toContain(internalDetail);
      }
    });

    it('error message identifies the failing service code', async () => {
      mockSend.mockRejectedValue(new Error('throttled'));

      try {
        await fetchPrice(QUERY, REGION);
      } catch (err) {
        expect((err as StackPriceError).message).toContain('AmazonEC2');
      }
    });

    it('throws StackPriceError with a hint when API rejects', async () => {
      mockSend.mockRejectedValue(new Error('AccessDenied'));

      try {
        await fetchPrice(QUERY, REGION);
      } catch (err) {
        expect(err).toBeInstanceOf(StackPriceError);
        expect((err as StackPriceError).hint).toBeDefined();
      }
    });

    it('throws StackPriceError when the API returns malformed JSON in PriceList', async () => {
      mockSend.mockResolvedValue({ PriceList: ['not valid { json'] });

      await expect(fetchPrice(QUERY, REGION)).rejects.toThrow(StackPriceError);
    });
  });
});
