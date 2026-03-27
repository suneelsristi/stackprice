export const EXIT_CODES = {
  SUCCESS: 0,
  PARTIAL: 1,
  FAILURE: 2,
} as const;

export class StackPriceError extends Error {
  constructor(
    message: string,
    public readonly exitCode: 0 | 1 | 2,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'StackPriceError';
  }
}
