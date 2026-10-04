import type { CatalogEntryKind } from '@suites/blackbox-catalog';
import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestDetails,
  TestInfo,
  TestStepInfo,
  TestType,
} from '@playwright/test';
import type {
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector';
import type { SandboxContainer, SandboxTelemetryStatus } from '@suites/blackbox-sandbox';
import type { BlackboxActivity } from './activity/activity-types.js';

export type BlackboxCatalogSelection =
  { readonly kind: 'unselected' } | { readonly kind: CatalogEntryKind; readonly id: string };

export interface BlackboxEntrypoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}

export interface BlackboxSandbox {
  readonly sandboxId: string;
  readonly executionId: string;
  readonly catalogEntry: {
    readonly id: string;
    readonly kind: CatalogEntryKind;
  };
  readonly projectName: string;
  readonly artifactDirectory: string;
  readonly entrypoint: BlackboxEntrypoint;
  readonly containers: ReadonlyMap<string, SandboxContainer>;
  /**
   * Run a setup command inside a participant container and record it as a linked
   * activity: the command gets its own trace through TRACEPARENT, and a root span
   * carrying `blackbox.activity.id` is exported to this attempt's collector.
   * `participant` is the catalog participant key; the command runs in its Compose service.
   */
  exec(participant: string, argv: readonly [string, ...string[]]): Promise<BlackboxActivity>;
}

export interface BlackboxTelemetry {
  readonly sessionId: string;
  readonly executionId: string;
  inspect(): Promise<SandboxTelemetryStatus>;
  read(): Promise<CollectorSessionReadResult>;
  readTrace(traceId: string): Promise<CollectorTraceReadResult>;
}

/** Attempt-scoped handle evaluated by the configured effects provider. */
export interface BlackboxEffects {
  readonly sessionId: string;
  readonly executionId: string;
}

export interface BlackboxTestOptions {
  /** Catalog entry selected for every test in the current Playwright scope. */
  readonly catalogEntry: BlackboxCatalogSelection;
  /** Compose substitution environment supplied to the selected sandbox. */
  readonly blackboxEnvironment: Readonly<Record<string, string>>;
  /**
   * Copy each finished attempt (sandbox record, telemetry and attempt document) to
   * `.blackbox/experiments/<sandboxId>/` beside the Blackbox configuration, where the
   * next Playwright run does not clear it. Default: false.
   */
  readonly blackboxRetainAttempts: boolean;
}

export interface BlackboxTestFixtures {
  /** Read-only identity and resources for this test's isolated sandbox. */
  readonly sandbox: BlackboxSandbox;
  /** Raw retained telemetry for this physical test attempt. */
  readonly telemetry: BlackboxTelemetry;
  /** Attempt-scoped handle for evaluating normalized behavioral contracts. */
  readonly effects: BlackboxEffects;
}

export type BlackboxSystemSelection =
  | string
  | {
      readonly kind: Exclude<CatalogEntryKind, 'unselected'>;
      readonly id: string;
    };

export interface BlackboxSandboxOptions {
  /** Compose substitution environment supplied only to this sandbox group. */
  readonly environment: Readonly<Record<string, string>>;
}

export type BlackboxNativeTestArgs = PlaywrightTestArgs &
  PlaywrightTestOptions &
  BlackboxTestFixtures;

export type BlackboxNativeWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;

export type BlackboxTestBody<TestArgs extends object, WorkerArgs extends object> = (
  args: TestArgs & WorkerArgs,
  testInfo: TestInfo,
) => unknown;

export type BlackboxStepOptions = Parameters<TestType<object, object>['step']>[2];

export type BlackboxStep = <T>(
  title: string,
  body: (step: TestStepInfo) => T | Promise<T>,
  options?: BlackboxStepOptions,
) => Promise<T>;

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
  /** Declares a native Playwright test in this sandbox configuration group. */
  readonly test: BlackboxSandboxTest<TestArgs, WorkerArgs>;
  /** Declares nested native Playwright suites and exposes describe.configure. */
  readonly describe: BlackboxSandboxDescribe;
  /** Registers an attempt-scoped native hook. */
  readonly beforeEach: TestType<TestArgs, WorkerArgs>['beforeEach'];
  /** Registers an attempt-scoped native hook. */
  readonly afterEach: TestType<TestArgs, WorkerArgs>['afterEach'];
  /** Runs a native Playwright step from a test or attempt-scoped hook. */
  readonly step: BlackboxStep;
}

export interface BlackboxSystemScope<TestArgs extends object, WorkerArgs extends object> {
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

export interface BlackboxSystemTest<
  TestArgs extends object = BlackboxNativeTestArgs,
  WorkerArgs extends object = BlackboxNativeWorkerArgs,
> {
  system(
    selection: BlackboxSystemSelection,
    callback: (system: BlackboxSystemScope<TestArgs, WorkerArgs>) => unknown,
  ): void;
  describe: BlackboxRootDescribe;
  beforeAll: BlackboxRootSuiteHook<TestArgs, WorkerArgs>;
  afterAll: BlackboxRootSuiteHook<TestArgs, WorkerArgs>;
  step: BlackboxStep;
  extend<T extends object, W extends object = object>(
    fixtures: Fixtures<T, W, TestArgs, WorkerArgs>,
  ): BlackboxSystemTest<TestArgs & T, WorkerArgs & W>;
}

export type { BlackboxActivity };
