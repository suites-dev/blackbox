import { expect, it } from 'vitest';

import {
  compileEffectContract,
  type EffectContract,
  type EffectContractBuilder,
} from './contract.js';

function compileUntyped(candidate: unknown): EffectContract {
  return compileEffectContract((() => candidate) as EffectContractBuilder);
}

function inherit(
  own: Readonly<Record<string, unknown>>,
  inherited: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const value = { ...own };
  Object.setPrototypeOf(value, inherited);
  return value;
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
        first: { node: 'selector', kind: 'db', operation: 'INSERT', target: 'orders' },
        second: { node: 'selector', kind: 'message', operation: 'send', target: 'orders' },
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

const operatorError = 'Effect constraint operator must be exactly, atLeast, atMost, or before';
const emptySelector = { node: 'selector' };
const countConstraint = {
  node: 'constraint',
  operator: 'exactly',
  count: 1,
  selector: emptySelector,
};
const orderConstraint = {
  node: 'constraint',
  operator: 'before',
  first: emptySelector,
  second: emptySelector,
};
const invalidCases = [
  ['missing operator', { node: 'constraint' }, operatorError],
  ['unknown operator', { node: 'constraint', operator: 'sometimes' }, operatorError],
  [
    'fractional count',
    { ...countConstraint, count: 1.5 },
    'Effect count must be a nonnegative safe integer',
  ],
  [
    'missing count',
    { node: 'constraint', operator: 'atLeast', selector: emptySelector },
    'Effect count must be a nonnegative safe integer',
  ],
  [
    'order fields on count',
    { ...countConstraint, first: emptySelector },
    'Unknown effect count constraint field: first',
  ],
  [
    'unsupported kind',
    { ...countConstraint, selector: { node: 'selector', kind: 'email' } },
    'exactly.selector.kind must be a supported effect kind',
  ],
  [
    'empty selector text',
    { ...countConstraint, selector: { ...emptySelector, operation: '' } },
    'exactly.selector.operation must be a non-empty string',
  ],
  [
    'non-finite where',
    {
      ...countConstraint,
      selector: { ...emptySelector, where: { value: Number.POSITIVE_INFINITY } },
    },
    'where must contain finite JSON scalar values',
  ],
  [
    'non-canonical alias',
    { ...countConstraint, selector: { ...emptySelector, method: 'POST' } },
    'Unknown effect selector field: method',
  ],
  [
    'missing first selector',
    { ...orderConstraint, first: undefined },
    'before.first must be an effect selector',
  ],
  [
    'constraint as selector',
    { ...orderConstraint, second: countConstraint },
    'before.second must be an effect selector',
  ],
  [
    'count fields on order',
    { ...orderConstraint, count: 1 },
    'Unknown effect order constraint field: count',
  ],
  [
    'inherited operator',
    inherit({ node: 'constraint', count: 1, selector: emptySelector }, { operator: 'exactly' }),
    operatorError,
  ],
  [
    'inherited count',
    inherit({ node: 'constraint', operator: 'exactly', selector: emptySelector }, { count: 1 }),
    'Effect count must be a nonnegative safe integer',
  ],
  [
    'inherited selector',
    inherit({ node: 'constraint', operator: 'exactly', count: 1 }, { selector: emptySelector }),
    'exactly.selector must be an effect selector',
  ],
] satisfies readonly (readonly [string, unknown, string])[];

it.each(invalidCases)('rejects a forged %s', (_name, constraint, message) => {
  expect(() => compileUntyped([constraint])).toThrow(message);
});

it('rejects sparse constraint arrays before evaluator delegation', () => {
  const sparse = new Array<unknown>(1);

  expect(() => compileUntyped(sparse)).toThrow(
    'The effects callback must return constraints, not selectors',
  );
});

it('reads numeric constraint slots instead of a caller-supplied array iterator', () => {
  const candidate = [countConstraint];
  candidate[Symbol.iterator] = () => [][Symbol.iterator]();

  expect(compileUntyped(candidate).constraints).toHaveLength(1);
});
