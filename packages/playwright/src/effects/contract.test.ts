import { expect, it } from 'vitest';

import { compileEffectContract } from './contract.js';

it('compiles selectors and constraints into an immutable provider contract', () => {
  const contract = compileEffectContract((effects) => [
    effects.exactly(
      1,
      effects.http({ actor: 'api', method: 'POST', route: '/orders', where: { retry: false } }),
    ),
    effects.absent(effects.message({ destination: 'dead-letter', operation: 'send' })),
    effects.before(
      effects.db({ operation: 'INSERT', table: 'orders' }),
      effects.message({ destination: 'orders', operation: 'send' }),
    ),
  ]);

  expect(contract).toEqual({
    schemaVersion: 1,
    constraints: [
      {
        node: 'constraint',
        operator: 'exactly',
        count: 1,
        selector: {
          node: 'selector',
          kind: 'http',
          actor: 'api',
          operation: 'POST',
          target: '/orders',
          where: { retry: false },
        },
      },
      {
        node: 'constraint',
        operator: 'exactly',
        count: 0,
        selector: {
          node: 'selector',
          kind: 'message',
          operation: 'send',
          target: 'dead-letter',
        },
      },
      {
        node: 'constraint',
        operator: 'before',
        first: {
          node: 'selector',
          kind: 'db',
          operation: 'INSERT',
          target: 'orders',
        },
        second: {
          node: 'selector',
          kind: 'message',
          operation: 'send',
          target: 'orders',
        },
      },
    ],
  });
  expect(Object.isFrozen(contract)).toBe(true);
  expect(Object.isFrozen(contract.constraints[0])).toBe(true);
});

it('rejects malformed contracts before they reach an effects provider', () => {
  expect(() => compileEffectContract(() => [])).toThrow('non-empty constraint array');
  expect(() => compileEffectContract((effects) => [effects.exactly(-1, effects.http())])).toThrow(
    'nonnegative safe integer',
  );
  expect(() =>
    compileEffectContract((effects) => [
      effects.exists(effects.http({ method: 'POST', operation: 'GET' })),
    ]),
  ).toThrow('Conflicting selector fields');
});
