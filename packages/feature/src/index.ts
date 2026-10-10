import { library } from './library/index.js';
import { createStepRunner } from './runtime/run-step.js';
import { test } from './runtime/scenario-test.js';

export { library } from './library/index.js';
export { parseGherkin } from './syntax/parse.js';
export type { ParsedGherkin } from './syntax/parse.js';
export { compileFeature } from './compiler.js';
export type {
  CompileFeatureOptions,
  CompileFeatureResult,
  FeatureClientBinding,
  FeatureDiagnostic,
} from './compiler.js';
export { sandboxCredentials } from './runtime/credentials.js';
export type {
  CredentialSource,
  ResolvedCredential,
  SandboxCredentialSpec,
  SandboxCredentials,
} from './runtime/credentials.js';
export { sandboxEnvironment } from './runtime/environment.js';
export type { EnvironmentSource, SandboxEnvironmentSpec } from './runtime/environment.js';
export { test };
export type { StepLibrary, StepLibraryIdentity, StepVocabularyEntry } from './runtime/library.js';
export type { StepRunner, StepSite } from './runtime/run-step.js';
export type {
  Capability,
  DataTableArgument,
  DocStringArgument,
  NoArgument,
  ScenarioWorld,
  StepArgument,
  StepFixtures,
  StepKind,
} from './runtime/step-types.js';

/** Runs a feature step against the shared executable vocabulary. */
export const runStep = createStepRunner(library, test.step);
