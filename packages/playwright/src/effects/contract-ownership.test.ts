import { expect, it } from 'vitest';

import {
  compileEffectContract,
  type EffectContract,
  type EffectContractBuilder,
  type EffectCountConstraint,
} from './contract.js';

function compileUntyped(candidate: unknown): EffectContract {
  return compileEffectContract((() => candidate) as EffectContractBuilder);
}

function firstCountConstraint(contract: EffectContract): EffectCountConstraint {
  const constraint = contract.constraints[0];
  if (constraint.operator === 'before') {
    throw new Error('Expected a count constraint');
  }
  return constraint;
}

function inherit(
  own: Readonly<Record<string, unknown>>,
  inherited: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const value = { ...own };
  Object.setPrototypeOf(value, inherited);
  return value;
}

it('snapshots nested selector input without freezing caller-owned data', () => {
  const where = { status: 'pending' };

  const contract = compileEffectContract((effects) => [
    effects.exists(effects.http({ method: 'POST', route: '/jobs', where })),
  ]);

  expect(Object.isFrozen(where)).toBe(false);
  where.status = 'complete';
  expect(contract.constraints[0]).toMatchObject({
    selector: { where: { status: 'pending' } },
  });
});

it('drops inherited selector fields while rebuilding a plain contract', () => {
  const selector = inherit({ node: 'selector', operation: 'INSERT' }, { kind: 'email' });
  const constraint = { node: 'constraint', operator: 'exactly', count: 1, selector };

  const contract = compileUntyped([constraint]);

  expect(contract.constraints[0]).toEqual({
    node: 'constraint',
    operator: 'exactly',
    count: 1,
    selector: { node: 'selector', operation: 'INSERT' },
  });
  expect(Object.getPrototypeOf(contract.constraints[0])).toBe(Object.prototype);
  expect(Object.getPrototypeOf(firstCountConstraint(contract).selector)).toBe(Object.prototype);
});

it('snapshots changing accessors exactly once before evaluator delegation', () => {
  let operatorReads = 0;
  let countReads = 0;
  let operationReads = 0;
  let whereReads = 0;
  const where = {
    get status(): string {
      whereReads += 1;
      return whereReads === 1 ? 'pending' : 'complete';
    },
  };
  const selector = {
    node: 'selector',
    kind: 'business',
    get operation(): string {
      operationReads += 1;
      return operationReads === 1 ? 'schedule' : 'cancel';
    },
    where,
  };
  const constraint = {
    node: 'constraint',
    get operator(): string {
      operatorReads += 1;
      return operatorReads === 1 ? 'exactly' : 'before';
    },
    get count(): number {
      countReads += 1;
      return countReads === 1 ? 1 : -1;
    },
    selector,
  };

  const contract = compileUntyped([constraint]);

  expect({ operatorReads, countReads, operationReads, whereReads }).toEqual({
    operatorReads: 1,
    countReads: 1,
    operationReads: 1,
    whereReads: 1,
  });
  expect(contract.constraints[0]).toEqual({
    node: 'constraint',
    operator: 'exactly',
    count: 1,
    selector: {
      node: 'selector',
      kind: 'business',
      operation: 'schedule',
      where: { status: 'pending' },
    },
  });
  expect(constraint.operator).toBe('before');
  expect(constraint.count).toBe(-1);
  expect(selector.operation).toBe('cancel');
  expect(where.status).toBe('complete');
  expect(firstCountConstraint(contract).selector.operation).toBe('schedule');
});

it('freezes only the rebuilt untyped contract', () => {
  const where = { table: 'orders' };
  const selector = { node: 'selector', kind: 'db', operation: 'INSERT', where };
  const constraint = { node: 'constraint', operator: 'exactly', count: 1, selector };

  const contract = compileUntyped([constraint]);

  expect(Object.isFrozen(contract)).toBe(true);
  expect(Object.isFrozen(contract.constraints)).toBe(true);
  expect(Object.isFrozen(contract.constraints[0])).toBe(true);
  const normalizedSelector = firstCountConstraint(contract).selector;
  expect(Object.isFrozen(normalizedSelector)).toBe(true);
  expect(Object.isFrozen(normalizedSelector.where)).toBe(true);
  expect([constraint, selector, where].filter(Object.isFrozen)).toEqual([]);
  where.table = 'payments';
  expect(contract.constraints[0]).toMatchObject({ selector: { where: { table: 'orders' } } });
});
