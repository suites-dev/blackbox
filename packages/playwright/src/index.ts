export { expect } from './effects/expect.js';
export { test } from './fixtures.js';
export type { EffectContractBuilder } from './effects/contract.js';
export { serializeEffectSnapshot } from './effects/emissions/snapshot.js';
export type { EffectCapture, EffectCaptureIdentity, EffectRecorder, EffectRecorderAssessment, EffectSnapshotOptions, EffectSnapshotValue } from '@suites/blackbox-effects';
export type { ExpectedEmission } from './effects/emissions/types.js';
export type { LazyEffectCapture, LazyEffectRecorder } from './effects/emissions/lazy/types.js';
export type { BlackboxClients, BlackboxEffects, BlackboxSandbox, BlackboxTelemetry, BlackboxTestFixtures, BlackboxTestArgs, BlackboxNativeStep, BlackboxStep, BlackboxOptions, BlackboxSystemSelection, BlackboxTestOptions } from './types.js';

export { defineClient } from './clients/clients.js';
export type {
  ClientDefinition,
  ClientRegistry,
  ClientTarget,
  RegisteredClients,
} from './clients/types.js';

export { assertionScope } from './assertions/scope.js';
export { AssertionScopeError } from './assertions/types.js';
export type { AssertionAccounting, AssertionScopeResult, AssertionScopeErrorCode } from './assertions/types.js';

export type { BlackboxState, StateObserver, StateReaders, StateValues, StateDiff, StateComparison } from './state/types.js';

export type { Stimulus, ExecutionResult, ExecutionEvidence, InitialState, WhenTitle, GivenTitle, VerifyTitle } from './stimulus/lifecycle/types.js';
