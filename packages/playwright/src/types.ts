import type { BlackboxNativeStep } from './steps/types.js';
import type { GherkinFeature } from './gherkin/types.js';
import type { ClientRegistry, RegisteredClients } from './clients/types.js';
import type { CatalogEntryKind } from '@suites/blackbox-catalog';
import type { BlackboxTestFixtures } from './fixture-types/index.js';
import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestDetails,
  TestInfo,
  TestType,
} from '@playwright/test';

export type {
  BlackboxEntrypoint,
  BlackboxSandbox,
  BlackboxTelemetry,
  BlackboxEffects,
  BlackboxTestFixtures,
} from './fixture-types/index.js';

export type {
  BlackboxNativeStep,
  BlackboxStep,
  BlackboxStepOptions,
  BlackboxStimulusScope,
} from './steps/types.js';
export type { BlackboxCatalogSelection, BlackboxTestOptions } from './config/options.js';

export type BlackboxSystemSelection =
  | string
  | {
      readonly kind: Exclude<CatalogEntryKind, 'unselected'>;
      readonly id: string;
    };

export type BlackboxSandboxOptions = Partial<{
  readonly environment: Readonly<Record<string, string>>;
  readonly clients: ClientRegistry;
}>;

export type BlackboxNativeTestArgs = PlaywrightTestArgs &
  PlaywrightTestOptions &
  BlackboxTestFixtures;

export type BlackboxNativeWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export type BlackboxTestBody<TestArgs extends object, WorkerArgs extends object> = (
  args: TestArgs & WorkerArgs,
  testInfo: TestInfo,
) => unknown;

export interface BlackboxSandboxTestModifier<TestArgs extends object, WorkerArgs extends object> {
  (title: string, body: BlackboxTestBody<TestArgs, WorkerArgs>): void;
  (title: string, details: TestDetails, body: BlackboxTestBody<TestArgs, WorkerArgs>): void;
}

export interface BlackboxSandboxTest<
  TestArgs extends object,
  WorkerArgs extends object,
> extends BlackboxSandboxTestModifier<TestArgs, WorkerArgs> {
  readonly only: BlackboxSandboxTestModifier<TestArgs, WorkerArgs>;
  readonly skip: BlackboxSandboxTestModifier<TestArgs, WorkerArgs>;
  readonly fixme: BlackboxSandboxTestModifier<TestArgs, WorkerArgs>;
}

export interface BlackboxDescribeModifier {
  (title: string, callback: () => unknown): void;
  (title: string, details: TestDetails, callback: () => unknown): void;
}

export interface BlackboxSandboxDescribe extends BlackboxDescribeModifier {
  readonly only: BlackboxDescribeModifier;
  readonly skip: BlackboxDescribeModifier;
  readonly fixme: BlackboxDescribeModifier;
  readonly configure: TestType<object, object>['describe']['configure'];
}

export type BlackboxRootDescribe = BlackboxSandboxDescribe;

export interface BlackboxSandboxSuite<TestArgs extends object, WorkerArgs extends object> {
  readonly Feature: GherkinFeature<TestArgs>;
  /** Declares a native Playwright test in this sandbox configuration group. */
  readonly test: BlackboxSandboxTest<TestArgs, WorkerArgs>;
  /** Declares nested native Playwright suites and exposes describe.configure. */
  readonly describe: BlackboxSandboxDescribe;
  /** Registers an attempt-scoped native hook. */
  readonly beforeEach: TestType<TestArgs, WorkerArgs>['beforeEach'];
  /** Registers an attempt-scoped native hook. */
  readonly afterEach: TestType<TestArgs, WorkerArgs>['afterEach'];
  /** Runs a native Playwright step from a test or attempt-scoped hook. */
  readonly step: BlackboxNativeStep;
}

export interface BlackboxSystemScope<TestArgs extends object, WorkerArgs extends object> {
  sandbox<const Definitions extends ClientRegistry>(
    name: string,
    options: BlackboxSandboxOptions & { readonly clients: Definitions },
    callback: (
      suite: BlackboxSandboxSuite<
        TestArgs & { readonly clients: RegisteredClients<Definitions> },
        WorkerArgs
      >,
    ) => unknown,
  ): void;
  sandbox(
    name: string,
    callback: (suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>) => unknown,
  ): void;
  sandbox(
    name: string,
    options: BlackboxSandboxOptions,
    callback: (suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>) => unknown,
  ): void;
}

export type BlackboxRootSuiteArgs<TestArgs extends object, WorkerArgs extends object> = Omit<
  TestArgs,
  keyof BlackboxTestFixtures
> &
  WorkerArgs;

export interface BlackboxRootSuiteHook<TestArgs extends object, WorkerArgs extends object> {
  (hook: (args: BlackboxRootSuiteArgs<TestArgs, WorkerArgs>, testInfo: TestInfo) => unknown): void;
  (
    title: string,
    hook: (args: BlackboxRootSuiteArgs<TestArgs, WorkerArgs>, testInfo: TestInfo) => unknown,
  ): void;
}

/** Callable system scope with a default-named sandbox shorthand. */
export interface BlackboxSystemDeclaration<TestArgs extends object, WorkerArgs extends object> {
  (
    selection: BlackboxSystemSelection,
    callback: (system: BlackboxSystemScope<TestArgs, WorkerArgs>) => unknown,
  ): void;
  sandbox<const Definitions extends ClientRegistry>(
    selection: BlackboxSystemSelection,
    options: BlackboxSandboxOptions & { readonly clients: Definitions },
    callback: (
      suite: BlackboxSandboxSuite<
        TestArgs & { readonly clients: RegisteredClients<Definitions> },
        WorkerArgs
      >,
    ) => unknown,
  ): void;
  sandbox(
    selection: BlackboxSystemSelection,
    callback: (suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>) => unknown,
  ): void;
  sandbox(
    selection: BlackboxSystemSelection,
    options: BlackboxSandboxOptions,
    callback: (suite: BlackboxSandboxSuite<TestArgs, WorkerArgs>) => unknown,
  ): void;
}

export interface BlackboxSystemTest<
  TestArgs extends object = BlackboxNativeTestArgs,
  WorkerArgs extends object = BlackboxNativeWorkerArgs,
> {
  readonly system: BlackboxSystemDeclaration<TestArgs, WorkerArgs>;
  describe: BlackboxRootDescribe;
  beforeAll: BlackboxRootSuiteHook<TestArgs, WorkerArgs>;
  afterAll: BlackboxRootSuiteHook<TestArgs, WorkerArgs>;
  step: BlackboxNativeStep;
  extend<T extends object, W extends object = object>(
    fixtures: Fixtures<T, W, TestArgs, WorkerArgs>,
  ): BlackboxSystemTest<TestArgs & T, WorkerArgs & W>;
}
