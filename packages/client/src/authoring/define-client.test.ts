import { describe, expect, it, vi } from 'vitest';

import { defineClient, InvalidClientDefinitionError } from './define-client.js';

describe('defineClient', () => {
  it.each(['', '   ', '\n\t', 'Orders client', 'orders_client', '-orders'])(
    'rejects a name that is not a lowercase slug: %j',
    (name) => {
      expect(() =>
        defineClient({ kind: 'utility', name, run: () => ({ kind: 'empty' }) }),
      ).toThrow(InvalidClientDefinitionError);
    },
  );

  it.each(['entrypoint', 'utility'] as const)('retains the %s behavioral kind', (kind) => {
    const run = vi.fn(() => ({ kind: 'text', value: 'ok' }) as const);
    const definition = defineClient({ kind, name: 'orders-client', run });

    expect(definition).toStrictEqual({ kind, name: 'orders-client', run });
    expect(Object.isFrozen(definition)).toBe(true);
  });
});
