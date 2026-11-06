import { expect as nativeExpect } from '@playwright/test';

import { assertionScope, expect, test } from '../../index.js';
import { deferred, record } from './evidence.fixture.js';

function accounting(value: unknown, total: number): void {
  nativeExpect(value).toEqual({ total, passed: total, failed: 0, pending: 0, unconsumed: 0 });
}

const custom = expect.extend({
  toBeEven(received: number) {
    return { pass: received % 2 === 0, message: () => 'Expected an even number' };
  },
  async toEventuallyBe(received: Promise<number>, expected: number) {
    return { pass: (await received) === expected, message: () => 'Expected asynchronous value' };
  },
});

test('counts native sync assertions and preserves the callback value', async () => {
  const value = { intent: 'payment-1' };
  const result = await assertionScope(() => {
    expect(2 + 2).toBe(4);
    expect(value).toEqual(expect.objectContaining({ intent: expect.any(String) }));
    expect(value.intent).not.toBe('different');
    return value;
  });
  nativeExpect(result.value).toBe(value);
  accounting(result.accounting, 3);
  record('sync', result.accounting);
});

test('counts awaited resolves and rejects assertions', async () => {
  const result = await assertionScope(async () => {
    await expect(Promise.resolve('accepted')).resolves.toBe('accepted');
    await expect(Promise.reject(new Error('declined'))).rejects.toThrow('declined');
  });
  accounting(result.accounting, 2);
});

test('tracks configured and soft successful assertions', async () => {
  const configured = expect.configure({ message: 'configured matcher', soft: true });
  const result = await assertionScope(() => {
    expect.soft(7).toBe(7);
    configured('yes').toBe('yes');
  });
  accounting(result.accounting, 2);
});

test('poll retries are provisional and count one terminal expectation', async () => {
  let samples = 0;
  const result = await assertionScope(async () => {
    await expect.poll(() => ++samples, { intervals: [1], timeout: 500 }).toBe(3);
  });
  nativeExpect(samples).toBe(3);
  accounting(result.accounting, 1);
});

test('toPass retries are provisional and count one terminal expectation', async () => {
  let attempts = 0;
  const result = await assertionScope(async () => {
    await expect(() => {
      expect(++attempts).toBe(3);
    }).toPass({ intervals: [1], timeout: 500 });
  });
  nativeExpect(attempts).toBe(3);
  accounting(result.accounting, 1);
});

test('native empty toPass remains a recognized weak expectation', async () => {
  const result = await assertionScope(async () => {
    await expect(() => undefined).toPass();
  });
  accounting(result.accounting, 1);
});

test('custom sync and async matcher implementations retain native semantics', async () => {
  const result = await assertionScope(async () => {
    custom(4).toBeEven();
    await custom(Promise.resolve(8)).toEventuallyBe(8);
  });
  accounting(result.accounting, 2);
});

test('reviewed native text snapshot counts as an assertion', async () => {
  const result = await assertionScope(() => {
    expect('reviewed payment evidence\n').toMatchSnapshot('accounting.txt');
  });
  accounting(result.accounting, 1);
});

test('nested scopes aggregate each logical assertion once', async () => {
  let innerAccounting: unknown;
  const outer = await assertionScope(async () => {
    expect('parent').toBe('parent');
    const inner = await assertionScope(() => {
      expect('child').toBe('child');
      return 9;
    });
    innerAccounting = inner.accounting;
    return inner.value;
  });
  nativeExpect(outer.value).toBe(9);
  accounting(innerAccounting, 1);
  accounting(outer.accounting, 2);
});

test('concurrent hard scopes isolate distinct asynchronous assertion histories', async () => {
  const leftEntered = deferred<undefined>();
  const rightEntered = deferred<undefined>();
  const [left, right] = await Promise.all([
    assertionScope(async () => {
      leftEntered.resolve(undefined);
      await rightEntered.promise;
      expect('left').toBe('left');
      return 'left';
    }),
    assertionScope(async () => {
      await leftEntered.promise;
      expect('right').toBe('right');
      rightEntered.resolve(undefined);
      await expect(Promise.resolve(2)).resolves.toBe(2);
      return 'right';
    }),
  ]);
  nativeExpect([left.value, right.value]).toEqual(['left', 'right']);
  accounting(left.accounting, 1);
  accounting(right.accounting, 2);
});

test('returned assertion promises are joined by the scope callback', async () => {
  const result = await assertionScope(() => expect(Promise.resolve(11)).resolves.toBe(11));
  accounting(result.accounting, 1);
});

test('awaited Promise.all joins both asynchronous assertions', async () => {
  const result = await assertionScope(async () => {
    await Promise.all([
      expect(Promise.resolve('a')).resolves.toBe('a'),
      expect(Promise.resolve('b')).resolves.toBe('b'),
    ]);
  });
  accounting(result.accounting, 2);
});

test('nested scope failures in an earlier toPass retry remain provisional', async () => {
  let attempts = 0;
  const result = await assertionScope(async () => {
    await expect(async () => {
      await assertionScope(() => {
        expect(++attempts).toBe(2);
      });
    }).toPass({ intervals: [1], timeout: 500 });
  });
  nativeExpect(attempts).toBe(2);
  accounting(result.accounting, 1);
});

test('poll provider failures in earlier samples remain provisional after a clean final sample', async () => {
  let samples = 0;
  const result = await assertionScope(async () => {
    await expect
      .poll(
        () => {
          samples += 1;
          try {
            expect(samples).toBe(2);
          } catch {
            // The first sample deliberately swallows a failed assertion and does not match.
          }
          return samples;
        },
        { intervals: [1], timeout: 500 },
      )
      .toBe(2);
  });
  nativeExpect(samples).toBe(2);
  accounting(result.accounting, 1);
});

test('composed custom matcher negation trusts the native terminal matcher verdict', async () => {
  const composed = expect.extend({
    toMatchValue(received: number, expected: number) {
      try {
        expect(received).toBe(expected);
        return { pass: true, message: () => 'Expected values to differ' };
      } catch {
        return { pass: false, message: () => 'Expected values to match' };
      }
    },
  });
  const result = await assertionScope(() => {
    composed(1).not.toMatchValue(2);
  });
  accounting(result.accounting, 1);
});
