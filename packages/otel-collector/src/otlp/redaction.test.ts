import { expect, it } from 'vitest';

import { redactTraceRequest } from './redaction.js';

it('redacts nested credential values and refuses a protected trace identifier', () => {
  const value = {
    attributes: [
      {
        key: 'nested',
        value: {
          kvlistValue: {
            values: [
              { key: 'db.password', value: { stringValue: 'hidden-password' } },
              { key: 'other', value: { stringValue: 'known-secret' } },
            ],
          },
        },
      },
    ],
  };
  const output = JSON.stringify(redactTraceRequest(value, ['known-secret']));
  expect(output).not.toContain('hidden-password');
  expect(output).not.toContain('known-secret');
  expect(output).toContain('[REDACTED]');
  expect(() => redactTraceRequest({ traceId: 'abc123' }, ['abc'])).toThrow('identity');
  expect(() => redactTraceRequest({ 'known-secret': 'value' }, ['known-secret'])).toThrow(
    'field name',
  );
});
