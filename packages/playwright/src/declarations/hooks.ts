import type { TestType } from '@playwright/test';

import type { BlackboxStep, BlackboxTestBody } from '../types.js';
import type { InternalTest } from './native.js';
import { declarationError } from './validation.js';

function assertActive(active: () => boolean): void {
  if (!active()) {
    throw declarationError('sandbox suite cannot be used after its declaration callback returns');
  }
}

export function createHook<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  active: () => boolean,
  mode: 'beforeEach' | 'afterEach',
): TestType<TestArgs, WorkerArgs>['beforeEach'] {
  type Body = BlackboxTestBody<TestArgs, WorkerArgs>;
  function hook(body: Body): void;
  function hook(title: string, body: Body): void;
  function hook(titleOrBody: string | Body, possibleBody?: Body): void {
    assertActive(active);
    if (typeof titleOrBody === 'function') {
      if (mode === 'beforeEach') {
        nativeTest.beforeEach(titleOrBody);
      } else {
        nativeTest.afterEach(titleOrBody);
      }
    } else if (possibleBody !== undefined) {
      if (mode === 'beforeEach') {
        nativeTest.beforeEach(titleOrBody, possibleBody);
      } else {
        nativeTest.afterEach(titleOrBody, possibleBody);
      }
    }
  }
  return hook;
}

export function createStep<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>): BlackboxStep {
  return nativeTest.step.bind(nativeTest);
}
