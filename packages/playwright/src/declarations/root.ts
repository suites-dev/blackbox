import type { TestDetails, TestInfo } from '@playwright/test';

import type {
  BlackboxDescribeModifier,
  BlackboxRootDescribe,
  BlackboxRootSuiteArgs,
  BlackboxRootSuiteHook,
  BlackboxStep,
} from '../types.js';
import type { InternalTest } from './native.js';
import { declarationError, ensureSynchronous } from './validation.js';

type DescribeMode = 'regular' | 'only' | 'skip' | 'fixme';

function assertRootScope(active: () => boolean, api: string): void {
  if (!active()) {
    throw declarationError(
      `${api} must be registered outside test.system and sandbox declarations`,
    );
  }
}

export function createRootHook<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  active: () => boolean,
  mode: 'beforeAll' | 'afterAll',
): BlackboxRootSuiteHook<TestArgs, WorkerArgs> {
  type Args = BlackboxRootSuiteArgs<TestArgs, WorkerArgs>;
  type Body = (args: Args, testInfo: TestInfo) => unknown;
  function hook(body: Body): void;
  function hook(title: string, body: Body): void;
  function hook(titleOrBody: string | Body, possibleBody?: Body): void {
    assertRootScope(active, `test.${mode}`);
    if (typeof titleOrBody === 'function') {
      if (mode === 'beforeAll') {
        nativeTest.beforeAll(titleOrBody);
      } else {
        nativeTest.afterAll(titleOrBody);
      }
    } else if (possibleBody !== undefined) {
      if (mode === 'beforeAll') {
        nativeTest.beforeAll(titleOrBody, possibleBody);
      } else {
        nativeTest.afterAll(titleOrBody, possibleBody);
      }
    }
  }
  return hook;
}

function createDescribeModifier<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  active: () => boolean,
  mode: DescribeMode,
): BlackboxDescribeModifier {
  function describe(title: string, callback: () => unknown): void;
  function describe(title: string, details: TestDetails, callback: () => unknown): void;
  function describe(
    title: string,
    detailsOrCallback: TestDetails | (() => unknown),
    possibleCallback?: () => unknown,
  ): void {
    assertRootScope(active, 'test.describe');
    const details = typeof detailsOrCallback === 'function' ? undefined : detailsOrCallback;
    const callback = typeof detailsOrCallback === 'function' ? detailsOrCallback : possibleCallback;
    if (callback === undefined) {
      return;
    }
    const checked = () => {
      const result = callback();
      ensureSynchronous(result, 'test.describe');
    };
    if (details === undefined) {
      declareDescribe(nativeTest, mode, { kind: 'plain', title, callback: checked });
    } else {
      declareDescribe(nativeTest, mode, {
        kind: 'detailed',
        title,
        callback: checked,
        details,
      });
    }
  }
  return describe;
}

function declareDescribe<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  mode: DescribeMode,
  declaration:
    | { readonly kind: 'plain'; readonly title: string; readonly callback: () => void }
    | {
        readonly kind: 'detailed';
        readonly title: string;
        readonly callback: () => void;
        readonly details: TestDetails;
      },
): void {
  if (declaration.kind === 'plain') {
    if (mode === 'regular') {
      nativeTest.describe(declaration.title, declaration.callback);
    } else if (mode === 'only') {
      nativeTest.describe.only(declaration.title, declaration.callback);
    } else if (mode === 'skip') {
      nativeTest.describe.skip(declaration.title, declaration.callback);
    } else {
      nativeTest.describe.fixme(declaration.title, declaration.callback);
    }
  } else if (mode === 'regular') {
    nativeTest.describe(declaration.title, declaration.details, declaration.callback);
  } else if (mode === 'only') {
    nativeTest.describe.only(declaration.title, declaration.details, declaration.callback);
  } else if (mode === 'skip') {
    nativeTest.describe.skip(declaration.title, declaration.details, declaration.callback);
  } else {
    nativeTest.describe.fixme(declaration.title, declaration.details, declaration.callback);
  }
}

export function createRootDescribe<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  active: () => boolean,
): BlackboxRootDescribe {
  return Object.assign(createDescribeModifier(nativeTest, active, 'regular'), {
    only: createDescribeModifier(nativeTest, active, 'only'),
    skip: createDescribeModifier(nativeTest, active, 'skip'),
    fixme: createDescribeModifier(nativeTest, active, 'fixme'),
    configure: (options: Parameters<typeof nativeTest.describe.configure>[0]) => {
      assertRootScope(active, 'test.describe.configure');
      nativeTest.describe.configure(options);
    },
  });
}

export function createRootStep<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>): BlackboxStep {
  return nativeTest.step.bind(nativeTest);
}
