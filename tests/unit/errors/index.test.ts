import { describe, it, expect } from 'vitest';
import { EXIT_CODES, StackPriceError } from '../../../src/errors/index.js';
import {
  NO_CREDENTIALS,
  cdkV1Detected,
  noManifest,
  regionDefaulted,
} from '../../../src/errors/messages.js';

// ─── EXIT_CODES ─────────────────────────────────────────────────────────────

describe('EXIT_CODES', () => {
  it('SUCCESS is 0', () => {
    expect(EXIT_CODES.SUCCESS).toBe(0);
  });

  it('PARTIAL is 1', () => {
    expect(EXIT_CODES.PARTIAL).toBe(1);
  });

  it('FAILURE is 2', () => {
    expect(EXIT_CODES.FAILURE).toBe(2);
  });
});

// ─── StackPriceError ─────────────────────────────────────────────────────────

describe('StackPriceError', () => {
  describe('constructor', () => {
    it('sets message', () => {
      const err = new StackPriceError('something went wrong', EXIT_CODES.FAILURE);
      expect(err.message).toBe('something went wrong');
    });

    it('sets exitCode', () => {
      const err = new StackPriceError('partial failure', EXIT_CODES.PARTIAL);
      expect(err.exitCode).toBe(1);
    });

    it('sets name to StackPriceError', () => {
      const err = new StackPriceError('fatal', EXIT_CODES.FAILURE);
      expect(err.name).toBe('StackPriceError');
    });

    it('sets hint when provided', () => {
      const err = new StackPriceError('no creds', EXIT_CODES.FAILURE, 'run aws configure');
      expect(err.hint).toBe('run aws configure');
    });

    it('hint is undefined when not provided', () => {
      const err = new StackPriceError('no creds', EXIT_CODES.FAILURE);
      expect(err.hint).toBeUndefined();
    });

    it('is an instance of Error', () => {
      const err = new StackPriceError('oops', EXIT_CODES.FAILURE);
      expect(err).toBeInstanceOf(Error);
    });

    it('is an instance of StackPriceError', () => {
      const err = new StackPriceError('oops', EXIT_CODES.FAILURE);
      expect(err).toBeInstanceOf(StackPriceError);
    });

    it('accepts SUCCESS exit code', () => {
      const err = new StackPriceError('ok', EXIT_CODES.SUCCESS);
      expect(err.exitCode).toBe(0);
    });
  });
});

// ─── Messages ────────────────────────────────────────────────────────────────

describe('NO_CREDENTIALS', () => {
  it('is a non-empty string', () => {
    expect(typeof NO_CREDENTIALS).toBe('string');
    expect(NO_CREDENTIALS.length).toBeGreaterThan(0);
  });

  it('mentions pricing:GetProducts', () => {
    expect(NO_CREDENTIALS).toContain('pricing:GetProducts');
  });

  it('mentions aws configure', () => {
    expect(NO_CREDENTIALS).toContain('aws configure');
  });
});

describe('cdkV1Detected', () => {
  it('includes the schema version in the message', () => {
    const msg = cdkV1Detected('1.0.0');
    expect(msg).toContain('1.0.0');
  });

  it('mentions CDK v2', () => {
    const msg = cdkV1Detected('1.0.0');
    expect(msg).toContain('CDK v2');
  });

  it('includes the migration docs link', () => {
    const msg = cdkV1Detected('5.0');
    expect(msg).toContain('https://docs.aws.amazon.com/cdk/v2/guide/migrating-v2.html');
  });
});

describe('noManifest', () => {
  it('includes the directory path in the message', () => {
    const msg = noManifest('/my/cdk.out');
    expect(msg).toContain('/my/cdk.out');
  });

  it('includes the expected manifest path', () => {
    const msg = noManifest('/my/cdk.out');
    expect(msg).toContain('/my/cdk.out/manifest.json');
  });

  it('mentions cdk synth', () => {
    const msg = noManifest('/some/dir');
    expect(msg).toContain('cdk synth');
  });
});

describe('regionDefaulted', () => {
  it('includes the stack ID in the message', () => {
    const msg = regionDefaulted('MyStack');
    expect(msg).toContain('MyStack');
  });

  it('mentions us-east-1', () => {
    const msg = regionDefaulted('MyStack');
    expect(msg).toContain('us-east-1');
  });

  it('mentions --region flag', () => {
    const msg = regionDefaulted('MyStack');
    expect(msg).toContain('--region');
  });
});
