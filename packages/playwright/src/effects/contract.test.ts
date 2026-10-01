import { expect, it } from 'vitest';

import {
  compileEffectContract,
  type EffectContract,
  type EffectContractBuilder,
} from './contract.js';

function compileUntyped(candidate: unknown): EffectContract {
  return compileEffectContract((() => candidate) as EffectContractBuilder);
}

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

it.each([
  {
    name: 'missing operator',
    constraint: { node: 'constraint' },
    message: 'Effect constraint operator must be exactly, atLeast, atMost, or before',
  },
  {
    name: 'unknown operator',
    constraint: { node: 'constraint', operator: 'sometimes' },
    message: 'Effect constraint operator must be exactly, atLeast, atMost, or before',
  },
  {
    name: 'fractional count',
    constraint: {
      node: 'constraint',
      operator: 'exactly',
      count: 1.5,
      selector: { node: 'selector' },
    },
    message: 'Effect count must be a nonnegative safe integer',
  },
  {
    name: 'missing count',
    constraint: {
      node: 'constraint',
      operator: 'atLeast',
      selector: { node: 'selector' },
    },
    message: 'Effect count must be a nonnegative safe integer',
  },
  {
    name: 'order operands on a count operator',
    constraint: {
      node: 'constraint',
      operator: 'atMost',
      count: 1,
      selector: { node: 'selector' },
      first: { node: 'selector' },
    },
    message: 'Unknown effect count constraint field: first',
  },
])('rejects a forged constraint with $name', ({ constraint, message }) => {
  expect(() => compileUntyped([constraint])).toThrow(message);
});

it.each([
  {
    name: 'unsupported kind',
    selector: { node: 'selector', kind: 'email' },
    message: 'exactly.selector.kind must be a supported effect kind',
  },
  {
    name: 'empty operation',
    selector: { node: 'selector', operation: '' },
    message: 'exactly.selector.operation must be a non-empty string',
  },
  {
    name: 'non-finite where value',
    selector: { node: 'selector', where: { duration: Number.POSITIVE_INFINITY } },
    message: 'where must contain finite JSON scalar values',
  },
  {
    name: 'non-canonical alias',
    selector: { node: 'selector', method: 'POST' },
    message: 'Unknown effect selector field: method',
  },
])('rejects a forged selector with $name', ({ selector, message }) => {
  expect(() =>
    compileUntyped([{ node: 'constraint', operator: 'exactly', count: 1, selector }]),
  ).toThrow(message);
});

it.each([
  {
    name: 'missing first selector',
    constraint: {
      node: 'constraint',
      operator: 'before',
      second: { node: 'selector', kind: 'message' },
    },
    message: 'before.first must be an effect selector',
  },
  {
    name: 'constraint in place of the second selector',
    constraint: {
      node: 'constraint',
      operator: 'before',
      first: { node: 'selector', kind: 'db' },
      second: { node: 'constraint', operator: 'exactly' },
    },
    message: 'before.second must be an effect selector',
  },
  {
    name: 'count operands on an order operator',
    constraint: {
      node: 'constraint',
      operator: 'before',
      first: { node: 'selector', kind: 'db' },
      second: { node: 'selector', kind: 'message' },
      count: 1,
    },
    message: 'Unknown effect order constraint field: count',
  },
])('rejects a forged order constraint with $name', ({ constraint, message }) => {
  expect(() => compileUntyped([constraint])).toThrow(message);
});

it('deep-freezes validated constraints returned by an untyped consumer', () => {
  const selector = { node: 'selector', kind: 'db', operation: 'INSERT' };
  const constraint = { node: 'constraint', operator: 'exactly', count: 1, selector };

  const contract = compileUntyped([constraint]);

  expect(Object.isFrozen(contract)).toBe(true);
  expect(Object.isFrozen(contract.constraints)).toBe(true);
  expect(Object.isFrozen(constraint)).toBe(true);
  expect(Object.isFrozen(selector)).toBe(true);
});
