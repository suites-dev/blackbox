import { expect, it } from 'vitest';

import { createRedactedError, redactEnvironmentError, redactProcessMetadata } from './secrets.js';

it('redacts error names and messages, including overlapping and empty environment values', () => {
  const error = Object.assign(new Error('long-private, private, empty'), { name: 'privateFailure' });
  const environment = { LONG: 'long-private', SHORT: 'private', EMPTY: '' };
  expect(redactEnvironmentError({ error, environment })).toEqual({
    name: '[REDACTED]Failure', message: '[REDACTED], [REDACTED], empty',
  });
  const redacted = createRedactedError({ error, values: Object.values(environment) });
  expect(redacted.stack).not.toContain('private');
});

it('does not reprocess generated masks when a secret overlaps the mask spelling', () => {
  expect(redactEnvironmentError({
    error: new Error('private-long REDACTED'),
    environment: { FIRST: 'private-long', SECOND: 'REDACTED' },
  })).toEqual({ name: 'Error', message: '[REDACTED] [REDACTED]' });
});

it('redacts a missing executable diagnostic and argv containing a declared secret', () => {
  expect(redactProcessMetadata({
    environment: { PASSWORD: 'private' },
    redaction: { kind: 'keys', keys: ['PASSWORD'] },
    process: { kind: 'executable-not-found', argv: ['private-tool'], location: { kind: 'host' },
      remediation: 'Install private-tool' },
  })).toEqual({
    kind: 'executable-not-found', argv: ['[REDACTED]-tool'], location: { kind: 'host' },
    remediation: 'Install [REDACTED]-tool',
  });
});
