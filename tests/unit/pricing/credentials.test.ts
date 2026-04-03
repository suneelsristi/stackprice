import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkCredentials } from '../../../src/pricing/credentials.js';
import { StackPriceError, EXIT_CODES } from '../../../src/errors/index.js';
import { NO_CREDENTIALS } from '../../../src/errors/messages.js';

vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: vi.fn(),
}));

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const mockFromNodeProviderChain = vi.mocked(fromNodeProviderChain);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkCredentials', () => {
  it('resolves without throwing when valid credentials are found', async () => {
    const mockProvider = vi.fn().mockResolvedValue({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    mockFromNodeProviderChain.mockReturnValue(mockProvider);

    await expect(checkCredentials()).resolves.toBeUndefined();
  });

  it('throws StackPriceError with exit code 2 when no credentials are found', async () => {
    const mockProvider = vi.fn().mockRejectedValue(
      new Error('Could not load credentials from any providers'),
    );
    mockFromNodeProviderChain.mockReturnValue(mockProvider);

    await expect(checkCredentials()).rejects.toThrow(StackPriceError);

    try {
      await checkCredentials();
    } catch (err) {
      expect(err).toBeInstanceOf(StackPriceError);
      const spe = err as StackPriceError;
      expect(spe.exitCode).toBe(EXIT_CODES.FAILURE);
    }
  });

  it('error message matches NO_CREDENTIALS exactly', async () => {
    const mockProvider = vi.fn().mockRejectedValue(
      new Error('Could not load credentials from any providers'),
    );
    mockFromNodeProviderChain.mockReturnValue(mockProvider);

    try {
      await checkCredentials();
    } catch (err) {
      const spe = err as StackPriceError;
      expect(spe.message).toBe(NO_CREDENTIALS);
    }
  });

  it('does not expose internal error details in the thrown error', async () => {
    const internalError = new Error('Internal AWS SDK secret details abc123');
    const mockProvider = vi.fn().mockRejectedValue(internalError);
    mockFromNodeProviderChain.mockReturnValue(mockProvider);

    try {
      await checkCredentials();
    } catch (err) {
      const spe = err as StackPriceError;
      expect(spe.message).not.toContain('abc123');
      expect(spe.message).not.toContain('Internal AWS SDK secret');
    }
  });
});
