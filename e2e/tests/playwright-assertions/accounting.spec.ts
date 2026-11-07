import { AssertionScopeError, expect, test } from '@suites/blackbox-playwright';

import { captured, endpoint } from './support.js';

const asyncExpect = expect.extend({
  async toHaveTenant(received: Promise<unknown>, tenant: string) {
    const value = await received;
    const pass =
      typeof value === 'object' && value !== null && 'tenant' in value && value.tenant === tenant;
    return { pass, message: () => `Expected the HTTP body to identify tenant ${tenant}` };
  },
});

test('assertion accounting: positive', async ({ request }, info) => {
  const result = await captured('positive', info, async () => {
    const response = await request.get(endpoint('/positive'));
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { tenant: string };
    expect(body.tenant).toBe('positive');
    return body.tenant;
  });
  expect(result.value).toBe('positive');
});

test('assertion accounting: empty', async ({ request }, info) => {
  await captured('empty', info, async () => {
    const response = await request.get(endpoint('/empty'));
    return response.json();
  });
});

test('assertion accounting: swallowed', async ({ request }, info) => {
  await captured('swallowed', info, async () => {
    const response = await request.get(endpoint('/swallowed'));
    try {
      expect(response.status()).toBe(418);
    } catch {
      return 'callback swallowed its failed status assertion';
    }
    return 'incorrectly accepted';
  });
});

test('assertion accounting: soft', async ({ request }, info) => {
  await captured('soft', info, async () => {
    const response = await request.get(endpoint('/soft'));
    expect.soft(response.status()).toBe(418);
    return response.json();
  });
});

test('assertion accounting: async', async ({ request }, info) => {
  await captured('async', info, async () => {
    const response = await request.get(endpoint('/async'));
    await asyncExpect(response.json()).toHaveTenant('async');
    await expect
      .poll(
        async () => {
          const sample = await request.get(endpoint('/async-poll'));
          return ((await sample.json()) as { ready: boolean }).ready;
        },
        { intervals: [10, 20, 50], timeout: 5_000 },
      )
      .toBe(true);
    return 'async response and retried poll checked';
  });
});

test('assertion accounting: isolation', async ({ request }, info) => {
  let assertionCompleted!: () => void;
  let emptyCompleted!: () => void;
  const asserted = new Promise<void>((resolve) => {
    assertionCompleted = resolve;
  });
  const emptyFinished = new Promise<void>((resolve) => {
    emptyCompleted = resolve;
  });
  const positive = captured('isolation-positive', info, async () => {
    try {
      const response = await request.get(endpoint('/isolation-positive'));
      expect(response.status()).toBe(200);
    } finally {
      assertionCompleted();
    }
    await emptyFinished;
    return 'independent successful scope';
  });
  const empty = captured('isolation-empty', info, async () => {
    await asserted;
    const response = await request.get(endpoint('/isolation-empty'));
    return response.json();
  }).finally(emptyCompleted);
  const [accepted, rejected] = await Promise.allSettled([positive, empty]);
  expect(accepted.status).toBe('fulfilled');
  expect(rejected.status).toBe('rejected');
  if (rejected.status === 'rejected') {
    expect(rejected.reason).toBeInstanceOf(AssertionScopeError);
  }
});
