import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect as nativeExpect } from '@playwright/test';

import { assertionScope, expect, test } from '../../index.js';
import { deferred, record } from './evidence.fixture.js';

async function rejected(title: string, callback: () => unknown) {
  try {
    const result = await assertionScope(callback);
    record('unexpected-success', { title, accounting: result.accounting });
  } catch (error) {
    record('rejected', {
      title,
      code: Reflect.get(Object(error), 'code'),
      message: String(error),
      accounting: Reflect.get(Object(error), 'accounting'),
    });
    throw error;
  }
}

const custom = expect.extend({
  toThrowUndefined() {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Regression: native soft completion can omit every outcome field.
    throw undefined;
  },
  async toEventuallyBe(received: Promise<number>, expected: number) {
    return { pass: (await received) === expected, message: () => 'Expected asynchronous value' };
  },
});

const cases = [
  ['empty callback', () => undefined],
  [
    'missing native completion outcome is unsupported',
    () => {
      custom.soft(1).toThrowUndefined();
    },
  ],
  [
    'raw native expect inside scope is unsupported',
    () => {
      nativeExpect(1).toBe(1);
    },
  ],
  [
    'matcher construction is not an assertion',
    () => {
      expect(1);
      expect.any(String);
    },
  ],
  [
    'swallowed synchronous failure',
    () => {
      try {
        expect(1).toBe(2);
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
      expect(3).toBe(3);
    },
  ],
  [
    'soft failure',
    () => {
      expect.soft(1).toBe(2);
      expect(3).toBe(3);
    },
  ],
  [
    'configured soft failure',
    () => {
      expect.configure({ soft: true })(1).toBe(2);
    },
  ],
  [
    'swallowed asynchronous failure',
    async () => {
      try {
        await expect(Promise.resolve(1)).resolves.toBe(2);
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
    },
  ],
  [
    'swallowed custom matcher failure',
    async () => {
      try {
        await custom(Promise.resolve(1)).toEventuallyBe(2);
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
    },
  ],
  [
    'swallowed terminal polling failure',
    async () => {
      try {
        await expect.poll(() => 1, { timeout: 30, intervals: [1] }).toBe(2);
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
    },
  ],
  [
    'poll provider cannot hide a swallowed final sample failure',
    async () => {
      await expect
        .poll(
          () => {
            try {
              expect(1).toBe(2);
            } catch {
              // Returning the matching value must not hide this final sample's failed assertion.
            }
            return 'matched';
          },
          { intervals: [1], timeout: 500 },
        )
        .toBe('matched');
    },
  ],
  [
    'swallowed terminal toPass failure',
    async () => {
      try {
        await expect(() => {
          expect(1).toBe(2);
        }).toPass({ timeout: 30, intervals: [1] });
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
    },
  ],
  [
    'toPass cannot hide a swallowed final iteration failure',
    async () => {
      await expect(() => {
        try {
          expect(1).toBe(2);
        } catch {
          /* Deliberately swallowed to challenge scope accounting. */
        }
      }).toPass({ timeout: 30 });
    },
  ],
  [
    'toPass cannot hide a soft final iteration failure',
    async () => {
      await expect(() => {
        expect.soft(1).toBe(2);
      }).toPass({ timeout: 30 });
    },
  ],
  [
    'caught failed child cannot verify parent',
    async () => {
      try {
        await assertionScope(() => {
          expect(1).toBe(2);
        });
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
      expect(3).toBe(3);
    },
  ],
  [
    'swallowed snapshot mismatch',
    () => {
      try {
        expect('wrong payment evidence\n').toMatchSnapshot('accounting.txt');
      } catch {
        /* Deliberately swallowed to challenge scope accounting. */
      }
    },
  ],
  [
    'settled but unconsumed asynchronous assertion',
    async () => {
      void expect(Promise.resolve(1)).resolves.toBe(1);
      await nextTurn();
    },
  ],
] satisfies readonly (readonly [string, () => unknown])[];

for (const [title, callback] of cases) {
  test(title, async () => {
    await rejected(title, callback);
  });
}

test('pending unawaited asynchronous assertion', async () => {
  const gate = deferred<number>();
  try {
    await rejected('pending unawaited asynchronous assertion', () => {
      void custom(gate.promise).toEventuallyBe(1);
    });
  } finally {
    gate.resolve(1);
    await nextTurn();
  }
});

test('foreign released matcher cannot assert in another scope', async () => {
  const first = await assertionScope(() => {
    expect(1).toBe(1);
    return expect(2);
  });
  await rejected('foreign released matcher cannot assert in another scope', () => {
    first.value.toBe(2);
  });
});

test('concurrent soft failure does not contaminate a passing sibling scope', async () => {
  const entered = deferred<undefined>();
  const results = await Promise.allSettled([
    assertionScope(async () => {
      await entered.promise;
      expect('left').toBe('left');
      return 'left';
    }),
    assertionScope(async () => {
      entered.resolve(undefined);
      await Promise.resolve();
      expect.soft('right').toBe('wrong');
    }),
  ]);
  nativeExpect(results[0].status).toBe('fulfilled');
  if (results[0].status === 'fulfilled') {
    record('concurrent-passing', results[0].value);
  }
  if (results[1].status === 'rejected') {
    record('rejected', {
      title: 'concurrent soft failure does not contaminate a passing sibling scope',
      code: Reflect.get(Object(results[1].reason), 'code'),
    });
    throw results[1].reason;
  }
  record('unexpected-success', {
    title: 'concurrent soft failure does not contaminate a passing sibling scope',
  });
});
