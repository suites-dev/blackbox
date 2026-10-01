import type { CatalogEntryKind } from '@suites/blackbox-catalog';
import type {
  CollectorSessionReadResult,
  CollectorTraceReadResult,
} from '@suites/blackbox-otel-collector';
import type { SandboxContainer, SandboxTelemetryStatus } from '@suites/blackbox-sandbox';

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
}

export interface BlackboxTestFixtures {
  /** Read-only identity and resources for this test's isolated sandbox. */
  readonly sandbox: BlackboxSandbox;
  /** Raw retained telemetry for this physical test attempt. */
  readonly telemetry: BlackboxTelemetry;
  /** Attempt-scoped handle for evaluating normalized behavioral contracts. */
  readonly effects: BlackboxEffects;
}
