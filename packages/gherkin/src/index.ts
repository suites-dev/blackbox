// Runtime for generated feature tests only. Hand-written tests use
// @suites/blackbox-playwright directly; nothing here registers steps.
import { library } from './library/index.js';
import { createStepRunner } from './runtime/run-step.js';
import { test } from './runtime/scenario-test.js';

export { sandboxEnvironment } from './runtime/environment.js';
export type { EnvironmentSource, SandboxEnvironmentSpec } from './runtime/environment.js';
export { test };
export type { StepRunner, StepSite } from './runtime/run-step.js';
export type {
  DataTableArgument,
  DocStringArgument,
  NoArgument,
  ScenarioWorld,
  StepArgument,
  StepFixtures,
} from './runtime/step-types.js';

/** Runs one compiled step against the shared library. Called only by generated code. */
export const runStep = createStepRunner(library, test.step);
