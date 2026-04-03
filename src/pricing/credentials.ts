import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { StackPriceError, EXIT_CODES } from '../errors/index.js';
import { NO_CREDENTIALS } from '../errors/messages.js';

export async function checkCredentials(): Promise<void> {
  const provider = fromNodeProviderChain();
  try {
    await provider();
  } catch {
    throw new StackPriceError(NO_CREDENTIALS, EXIT_CODES.FAILURE);
  }
}
