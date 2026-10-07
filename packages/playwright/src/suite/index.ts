// @suites/blackbox-playwright/suite: what a command plugin needs to write and
// check committed Playwright suites for features. Plain data in and out; the
// plugin parses features and suite files and passes their outlines here.

export {
  sentences,
  type Capability,
  type Sentence,
  type SentenceParameterType,
} from './sentences.js';
export type {
  FeatureOutline,
  FeatureSandboxProfile,
  FeatureScenario,
  FeatureStep,
  LibraryCallBody,
  StepArgument,
  StepValue,
  SuiteOutline,
  SuiteScenario,
  SuiteStep,
  SuiteStepBody,
  TodoBody,
  WrittenBody,
} from './outline.js';
export {
  matchSentence,
  type KnownSentence,
  type SentenceMatch,
  type UnknownSentence,
} from './match.js';
export {
  EMIT_COMMAND,
  renderScenario,
  renderStep,
  renderSuite,
  SUITE_RUNTIME_MODULE,
  TODO_MESSAGE,
} from './render/render.js';
export { findDrift } from './drift/drift.js';
export type { DriftFinding, DriftFix, DriftKind, EditFix, EmitFix } from './drift/findings.js';
