// Reads and validates Gherkin feature files. It never imports Playwright or the
// step library: sentences arrive as plain data (SentenceList), and the outline
// leaves as plain data for whatever emits or compares a suite.

export {
  formatValidationError,
  InvalidFeatureError,
  type ValidationError,
  type ValidationErrorCode,
} from './feature/diagnostics.js';
export type {
  DataTableArgument,
  DocStringArgument,
  ExampleRow,
  ExampleValue,
  NoArgument,
  StepArgument,
} from './feature/model.js';
export type {
  FeatureOutline,
  OutlineBackground,
  OutlineRule,
  OutlineScenario,
  OutlineStep,
} from './outline/model.js';
export { outline, outlineFeature } from './outline/outline.js';
export {
  GHERKIN_CONFIG_FILE,
  GherkinConfigError,
  loadGherkinProject,
  parseGherkinProject,
  type CredentialSource,
  type EnvironmentSource,
  type GherkinProject,
  type SandboxProfile,
} from './project/config.js';
export type {
  Sentence,
  SentenceArgument,
  SentenceLibrary,
  SentenceList,
  SentenceParameterType,
} from './sentences/model.js';
export { validate } from './validation/validate.js';
