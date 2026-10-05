import type { TestDetails } from '@playwright/test';

import type {
  BlackboxDescribeModifier,
  BlackboxSandboxDescribe,
  BlackboxSandboxSuite,
  BlackboxSandboxTest,
} from '../types.js';
import { createHook, createStep } from './hooks.js';
import type { InternalTest } from './native.js';
import { declarationError, ensureSynchronous } from './validation.js';

type DescribeMode = 'regular' | 'only' | 'skip' | 'fixme';

export interface SandboxSuiteDeclaration<TestArgs extends object, WorkerArgs extends object> {
  readonly suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>;
  revoke(): void;
}

interface RevocableTestDeclaration<TestArgs extends object, WorkerArgs extends object> {
  readonly test: BlackboxSandboxTest<TestArgs, WorkerArgs>;
  revoke(): void;
}

function assertActive(active: () => boolean): void {
  if (!active()) {
    throw declarationError('sandbox suite cannot be used after its declaration callback returns');
  }
}

function createTestDeclaration<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
): RevocableTestDeclaration<TestArgs, WorkerArgs> {
  const only = Proxy.revocable(nativeTest.only.bind(nativeTest), {});
  const skip = Proxy.revocable(nativeTest.skip.bind(nativeTest), {});
  const fixme = Proxy.revocable(nativeTest.fixme.bind(nativeTest), {});
  // Deliberately omit an apply trap so Playwright captures the user's file and line.
  // Revoking this proxy and its modifiers rejects declaration handles that escape the scope.
  const callable = Proxy.revocable(nativeTest, {
    get(target, property, receiver) {
      if (property === 'only') {
        return only.proxy;
      }
      if (property === 'skip') {
        return skip.proxy;
      }
      if (property === 'fixme') {
        return fixme.proxy;
      }
      if (
        property === 'name' ||
        property === 'length' ||
        property === 'prototype' ||
        property === 'toString' ||
        property === 'call' ||
        property === 'apply' ||
        property === 'bind'
      ) {
        const value: unknown = Reflect.get(target, property, receiver);
        return value;
      }
      return undefined;
    },
  });
  const test: BlackboxSandboxTest<TestArgs, WorkerArgs> = callable.proxy;
  return {
    test,
    revoke() {
      callable.revoke();
      only.revoke();
      skip.revoke();
      fixme.revoke();
    },
  };
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
  function modifier(title: string, callback: () => unknown): void;
  function modifier(title: string, details: TestDetails, callback: () => unknown): void;
  function modifier(
    title: string,
    detailsOrCallback: TestDetails | (() => unknown),
    callback?: () => unknown,
  ): void {
    assertActive(active);
    const details = typeof detailsOrCallback === 'function' ? undefined : detailsOrCallback;
    const declaration = typeof detailsOrCallback === 'function' ? detailsOrCallback : callback;
    if (declaration === undefined) {
      return;
    }
    const checked = () => {
      const result = declaration();
      ensureSynchronous(result, 'describe');
    };
    if (details === undefined) {
      declareNativeDescribe(nativeTest, mode, { kind: 'plain', title, callback: checked });
    } else {
      declareNativeDescribe(nativeTest, mode, {
        kind: 'detailed',
        title,
        callback: checked,
        details,
      });
    }
  }
  return modifier;
}

function declareNativeDescribe<
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
    return;
  }
  if (mode === 'regular') {
    nativeTest.describe(declaration.title, declaration.details, declaration.callback);
  } else if (mode === 'only') {
    nativeTest.describe.only(declaration.title, declaration.details, declaration.callback);
  } else if (mode === 'skip') {
    nativeTest.describe.skip(declaration.title, declaration.details, declaration.callback);
  } else {
    nativeTest.describe.fixme(declaration.title, declaration.details, declaration.callback);
  }
}

export function createSandboxSuite<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  active: () => boolean,
): SandboxSuiteDeclaration<TestArgs, WorkerArgs> {
  const testDeclaration = createTestDeclaration(nativeTest);
  const describe: BlackboxSandboxDescribe = Object.assign(
    createDescribeModifier(nativeTest, active, 'regular'),
    {
      only: createDescribeModifier(nativeTest, active, 'only'),
      skip: createDescribeModifier(nativeTest, active, 'skip'),
      fixme: createDescribeModifier(nativeTest, active, 'fixme'),
      configure: (options: Parameters<typeof nativeTest.describe.configure>[0]) => {
        assertActive(active);
        nativeTest.describe.configure(options);
      },
    },
  );
  return Object.freeze({
    suite: Object.freeze({
      test: testDeclaration.test,
      describe,
      beforeEach: createHook(nativeTest, active, 'beforeEach'),
      afterEach: createHook(nativeTest, active, 'afterEach'),
      step: createStep(nativeTest),
    }),
    revoke: () => {
      testDeclaration.revoke();
    },
  });
}
