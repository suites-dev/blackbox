import { expect as nativeExpect } from '@playwright/test';

import { assertionScope, expect, test } from '../../index.js';
import { createBlackboxEffects } from '../../effects/runtime.js';
import { deferred, record } from './evidence.fixture.js';

let suiteHookError: unknown;
test.beforeAll(async () => {
  try {
    await assertionScope(() => {
      expect(1).toBe(1);
    });
  } catch (error) {
    suiteHookError = error;
  }
});

test('suite hooks cannot create an assertion owner', () => {
  nativeExpect(suiteHookError).toMatchObject({ code: 'ownership' });
});

test('ordinary native assertions and existing effects work outside explicit scopes', async () => {
  expect(1).toBe(1);
  await expect(Promise.resolve('native')).resolves.toBe('native');
  const effects = createBlackboxEffects({
    sessionId: 'assertion-compatibility-session',
    executionId: 'assertion-compatibility-execution',
    evaluator: { evaluate: () => Promise.resolve({ kind: 'satisfied' }) },
  });
  await expect(effects).toSatisfy((contract) => [contract.exists(contract.http())]);
  record('outside-scope-native', 'completed');
});

test('assertions attempted after scope completion are rejected while owner remains active', async () => {
  const released = deferred<undefined>();
  let continuation: Promise<void> | undefined;
  await assertionScope(() => {
    expect('owned').toBe('owned');
    continuation = released.promise.then(() => {
      try {
        expect('late').toBe('late');
        record('unexpected-leak-success', null);
      } catch (error) {
        record('leak-rejected', { code: Reflect.get(Object(error), 'code') });
        throw error;
      }
    });
  });
  released.resolve(undefined);
  await continuation;
});

test('owner teardown rejects an unjoined scope that is still pending', () => {
  const gate = deferred<undefined>();
  void assertionScope(async () => {
    expect('started').toBe('started');
    record('pending-scope-started', 'waiting on owned barrier');
    await gate.promise;
  }).catch((error: unknown) => {
    record('pending-scope-rejected', String(error));
  });
});
