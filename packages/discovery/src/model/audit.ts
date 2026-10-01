import type { Approval, EnvironmentInput, Evidence } from './evidence.js';
import type { Boundary, Graph } from './graph.js';

export type Stage =
  | Readonly<{ kind: 'not-run'; reason: string }>
  | Readonly<{ kind: 'not-required'; reason: string }>
  | Readonly<{ kind: 'blocked'; reason: string }>
  | Readonly<{ kind: 'failed'; reason: string; receiptIds: readonly string[] }>
  | Readonly<{ kind: 'passed'; receiptIds: readonly string[] }>;

export type Stages = Readonly<{
  catalog: Stage;
  acquisition: Stage;
  readiness: Stage;
  setup: Stage;
  stimulus: Stage;
  terminal: Stage;
  observation: Stage;
  cleanup: Stage;
}>;

export type Claim = Readonly<{
  id: string;
  question: string;
  acceptedBy: string;
  predicate: string;
  entryIds: readonly string[];
  terminalIds: readonly string[];
  requiredObservationIds: readonly string[];
  businessId: string;
  timeoutMs: number;
}>;

export type Task =
  | Readonly<{ kind: 'inventory' }>
  | Readonly<{ kind: 'preflight' }>
  | Readonly<{ kind: 'exercise'; claim: Claim }>;

export type Execution =
  | Readonly<{ kind: 'not-run'; reason: string }>
  | Readonly<{
      kind: 'capsule';
      capsuleId: string;
      attemptId: string;
      activityIds: readonly string[];
    }>;

/** Operability is scoped to the exercised claim, not universal program correctness. */
export type Operability =
  | Readonly<{ kind: 'not-assessed'; reason: string }>
  | Readonly<{ kind: 'operable'; claimId: string }>
  | Readonly<{ kind: 'inoperable'; reason: string }>
  | Readonly<{ kind: 'inconclusive'; reason: string }>;

export type Audit = Readonly<{
  schemaVersion: 1;
  kind: 'discovery-audit';
  mode: 'initial' | 'reconcile';
  task: Task;
  project: Readonly<{ repository: string; revision: string }>;
  catalog:
    | Readonly<{ kind: 'absent'; reason: string }>
    | Readonly<{ kind: 'selected'; entryId: string; schemaId: string; digest: string }>;
  approvals: readonly Approval[];
  evidence: readonly Evidence[];
  graph: Graph;
  boundary: Boundary;
  environment: readonly EnvironmentInput[];
  execution: Execution;
  stages: Stages;
  operability: Operability;
  outcome:
    | Readonly<{ kind: 'complete' }>
    | Readonly<{ kind: 'incomplete' | 'blocked' | 'failed'; reasons: readonly string[] }>;
  limitations: readonly string[];
  nextActions: readonly string[];
}>;

/** An inspector emits a fragment; it never modifies the application's catalog itself. */
export type InspectorResult = Readonly<{
  schemaVersion: 1;
  inspector: string;
  version: string;
}> &
  (
    | Readonly<{ kind: 'inspected'; graph: Graph; evidence: readonly Evidence[] }>
    | Readonly<{ kind: 'blocked'; reasons: readonly string[] }>
    | Readonly<{ kind: 'failed'; reasons: readonly string[] }>
  );
