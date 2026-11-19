export type Json = null | boolean | number | string | Json[] | { readonly [key: string]: Json };

export interface ArtifactView {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: number | null;
  readonly digest: string | null;
  readonly source: 'body' | 'path' | 'missing';
  readonly path: string | null;
}

export interface StepView {
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly error: string | null;
  readonly evidence: readonly string[];
  readonly snapshots: Json | null;
}

export interface EffectsView {
  readonly status: 'captured' | 'missing' | 'unavailable';
  readonly digest: string | null;
  readonly coverage: Json | null;
  readonly effects: readonly Json[];
  readonly relations: readonly Json[];
  readonly omitted: Json | null;
  readonly captures: readonly Json[];
}

export interface ExecutionView {
  readonly executionId: string;
  readonly title: string;
  readonly steps: readonly StepView[];
  readonly output: Json | null;
  readonly initial: Json | null;
  readonly final: Json | null;
  readonly diff: Json | null;
  readonly effects: EffectsView;
  readonly captureFailures: readonly StepView[];
}

export interface AttemptView {
  readonly schemaVersion: 1;
  readonly kind: 'blackbox-attempt-view';
  readonly test: {
    readonly id: string;
    readonly titlePath: readonly string[];
    readonly project: string | null;
    readonly file: string;
    readonly line: number;
  };
  readonly attempt: {
    readonly retry: number;
    readonly workerIndex: number;
    readonly parallelIndex: number;
    readonly nativeStatus: string;
    readonly expectedStatus: string;
    readonly durationMs: number;
    readonly errors: readonly string[];
  };
  readonly verification: {
    readonly status: 'verified' | 'failed' | 'inconclusive' | 'not-evaluated' | 'unavailable';
    readonly passed: number;
    readonly failed: number;
    readonly inconclusive: number;
    readonly interrupted: number;
  };
  readonly evidence: {
    readonly status: 'available' | 'partial' | 'unavailable';
    readonly problems: readonly string[];
    readonly artifacts: readonly ArtifactView[];
    readonly captureHealth: {
      readonly status: 'captured' | 'failed' | 'not-configured' | 'unavailable';
      readonly record: Json | null;
    };
  };
  readonly executions: readonly ExecutionView[];
}
