// Reads and validates Gherkin feature files. It never imports Playwright or the
// step library: sentences arrive as plain data (SentenceList).

export {
  formatValidationError,
  type ValidationError,
  type ValidationErrorCode,
} from './feature/diagnostics.js';
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
