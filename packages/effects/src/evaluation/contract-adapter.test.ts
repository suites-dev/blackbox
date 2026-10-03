import { expect, test } from 'vitest';
import { compileEffectContract } from '../contract.js';
import { adaptContract } from './contract-adapter.js';

test('maps public count aliases and order operands without changing selectors', () => {
  const publicContract = compileEffectContract((fx) => {
    const request = fx.http({ method: 'POST', route: '/orders' });
    const insert = fx.db({ operation: 'INSERT', table: 'orders' });
    return [
      fx.exists(insert),
      fx.absent(insert),
      fx.exactly(2, insert),
      fx.atMost(3, insert),
      fx.before(request, insert),
      fx.after(insert, request),
    ];
  });
  const adapted = adaptContract(publicContract);
  expect(adapted.schemaVersion).toBe('0.1.0');
  expect(adapted.constraints.map((constraint) => constraint.op)).toEqual([
    'atLeast',
    'exactly',
    'exactly',
    'atMost',
    'before',
    'before',
  ]);
  expect(adapted.constraints[0]).toMatchObject({
    n: 1,
    selector: { kind: 'db', operation: 'INSERT', target: 'orders' },
  });
  expect(adapted.constraints[1]).toMatchObject({ n: 0 });
  expect(adapted.constraints[4]).toEqual(adapted.constraints[5]);
  expect(adapted.constraints[4]).toMatchObject({
    a: { kind: 'http', operation: 'POST', target: '/orders' },
    b: { kind: 'db', operation: 'INSERT', target: 'orders' },
  });
});
