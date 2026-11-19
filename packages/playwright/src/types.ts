import type { BlackboxTestOptions } from './config/options.js';
import type { BlackboxStep } from './steps/types.js';
import type { CatalogEntryKind } from '@suites/blackbox-catalog';
import type {
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from '@playwright/test';
import type {
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector';
import type { SandboxContainer, SandboxTelemetryStatus } from '@suites/blackbox-sandbox';

export type {
  BlackboxNativeStep,
  BlackboxStep,
  BlackboxStepOptions,
  BlackboxStimulusScope,
} from './steps/types.js';
export type { BlackboxCatalogSelection, BlackboxTestOptions, BlackboxOptions, BlackboxSystemSelection } from './config/options.js';

/** Augment this interface in your project to type registered client handles. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Public module augmentation point.
export interface BlackboxClients {}

export interface BlackboxEntrypoint {
  readonly url: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: string;
}

export interface BlackboxSandbox extends Partial<
  Record<'clientServices', Readonly<Record<string, string>>>
> {
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

export interface BlackboxTestFixtures {
  readonly clients: Readonly<BlackboxClients>;
  /** Read-only identity and resources for this test's isolated sandbox. */
  readonly sandbox: BlackboxSandbox;
  /** Raw retained telemetry for this physical test attempt. */
  readonly telemetry: BlackboxTelemetry;
  /** Attempt-scoped handle for evaluating normalized behavioral contracts. */
  readonly effects: BlackboxEffects;
  readonly step: BlackboxStep;
}

export type BlackboxTestArgs = PlaywrightTestArgs & PlaywrightTestOptions &
  BlackboxTestFixtures & BlackboxTestOptions;
export type BlackboxNativeTestArgs = BlackboxTestArgs;
export type BlackboxNativeWorkerArgs = PlaywrightWorkerArgs & PlaywrightWorkerOptions;
