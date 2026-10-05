import type { Fixtures } from '@playwright/test';

import type { InternalTest } from './declarations/native.js';
import { createRootDescribe, createRootHook, createRootStep } from './declarations/root.js';
import { createSandboxSuite } from './declarations/suite.js';
import {
  declarationError,
  ensureSynchronous,
  environmentValue,
  nonemptyString,
  selectionValue,
  type SelectedSystem,
} from './declarations/validation.js';
import type {
  BlackboxSandboxOptions,
  BlackboxSandboxSuite,
  BlackboxSystemScope,
  BlackboxSystemSelection,
  BlackboxSystemTest,
  BlackboxTestOptions,
} from './types.js';

interface DeclarationState {
  phase: 'idle' | 'system' | 'sandbox';
}

type UseBlackboxOptions = (options: BlackboxTestOptions) => void;

function createUseBlackboxOptions<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>): UseBlackboxOptions {
  const use = nativeTest.use.bind(nativeTest) as UseBlackboxOptions;
  return (options) => {
    use(options);
  };
}

interface SandboxDeclarationContext {
  readonly state: DeclarationState;
  readonly selected: Readonly<SelectedSystem>;
  readonly systemActive: () => boolean;
  readonly useBlackboxOptions: UseBlackboxOptions;
}

interface SandboxGroupInput<TestArgs extends object, WorkerArgs extends object> {
  readonly state: DeclarationState;
  readonly selected: Readonly<SelectedSystem>;
  readonly name: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly callback: (suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>) => unknown;
  readonly useBlackboxOptions: UseBlackboxOptions;
}

function createSandboxDeclaration<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  context: SandboxDeclarationContext,
): BlackboxSystemScope<TestArgs, WorkerArgs>['sandbox'] {
  type Suite = BlackboxSandboxSuite<TestArgs, WorkerArgs>;
  function sandbox(name: string, callback: (suite: Suite) => unknown): void;
  function sandbox(
    name: string,
    options: BlackboxSandboxOptions,
    callback: (suite: Suite) => unknown,
  ): void;
  function sandbox(
    name: string,
    optionsOrCallback: BlackboxSandboxOptions | ((suite: Suite) => unknown),
    possibleCallback?: (suite: Suite) => unknown,
  ): void {
    if (!context.systemActive()) {
      throw declarationError('system scope cannot be used after its callback returns');
    }
    if (context.state.phase !== 'system') {
      throw declarationError('sandbox declarations cannot be nested');
    }
    const sandboxName = nonemptyString(name, 'sandbox name');
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : possibleCallback;
    if (callback === undefined) {
      throw declarationError('system.sandbox requires a synchronous callback');
    }
    declareSandboxGroup(nativeTest, {
      state: context.state,
      selected: context.selected,
      name: sandboxName,
      environment: environmentValue(options),
      callback,
      useBlackboxOptions: context.useBlackboxOptions,
    });
  }
  return sandbox;
}

function declareSandboxGroup<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  input: SandboxGroupInput<TestArgs, WorkerArgs>,
): void {
  nativeTest.describe(`sandbox ${JSON.stringify(input.name)}`, () => {
    input.useBlackboxOptions({
      catalogEntry: input.selected,
      blackboxEnvironment: input.environment,
    });
    input.state.phase = 'sandbox';
    let active = true;
    const declaration = createSandboxSuite(nativeTest, () => active);
    try {
      const result = input.callback(declaration.suite);
      ensureSynchronous(result, 'system.sandbox');
    } finally {
      active = false;
      declaration.revoke();
      input.state.phase = 'system';
    }
  });
}

function createSystemDeclaration<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  state: DeclarationState,
  useBlackboxOptions: UseBlackboxOptions,
): BlackboxSystemTest<TestArgs, WorkerArgs>['system'] {
  return (selection: BlackboxSystemSelection, callback) => {
    if (state.phase !== 'idle') {
      throw declarationError('test.system declarations cannot be nested');
    }
    const selected = selectionValue(selection);
    nativeTest.describe(`${selected.kind} ${JSON.stringify(selected.id)}`, () => {
      state.phase = 'system';
      let active = true;
      const system: BlackboxSystemScope<TestArgs, WorkerArgs> = Object.freeze({
        sandbox: createSandboxDeclaration(nativeTest, {
          state,
          selected,
          systemActive: () => active,
          useBlackboxOptions,
        }),
      });
      try {
        const result = callback(system);
        ensureSynchronous(result, 'test.system');
      } finally {
        active = false;
        state.phase = 'idle';
      }
    });
  };
}

function createFacade<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
  state: DeclarationState,
  useBlackboxOptions: UseBlackboxOptions,
): BlackboxSystemTest<TestArgs, WorkerArgs> {
  function flatTest(): never {
    throw declarationError('tests must be declared inside test.system(...).sandbox(...)');
  }
  function extend<T extends object, W extends object = object>(
    fixtures: Fixtures<T, W, TestArgs, WorkerArgs>,
  ): BlackboxSystemTest<TestArgs & T, WorkerArgs & W> {
    const extendNative = nativeTest.extend.bind(nativeTest) as <
      ExtendedTest extends object,
      ExtendedWorker extends object,
    >(
      declared: Fixtures<ExtendedTest, ExtendedWorker, TestArgs, WorkerArgs>,
    ) => InternalTest<TestArgs & ExtendedTest, WorkerArgs & ExtendedWorker, InternalArgs>;
    const extended = extendNative(fixtures);
    return createFacade(extended, state, createUseBlackboxOptions(extended));
  }
  const rootActive = () => state.phase === 'idle';
  return Object.assign(flatTest, {
    system: createSystemDeclaration(nativeTest, state, useBlackboxOptions),
    describe: createRootDescribe(nativeTest, rootActive),
    beforeAll: createRootHook(nativeTest, rootActive, 'beforeAll'),
    afterAll: createRootHook(nativeTest, rootActive, 'afterAll'),
    step: createRootStep(nativeTest),
    extend,
  });
}

export function createSystemTestFacade<
  TestArgs extends object,
  WorkerArgs extends object,
  InternalArgs extends object,
>(
  nativeTest: InternalTest<TestArgs, WorkerArgs, InternalArgs>,
): BlackboxSystemTest<TestArgs, WorkerArgs> {
  return createFacade(nativeTest, { phase: 'idle' }, createUseBlackboxOptions(nativeTest));
}
