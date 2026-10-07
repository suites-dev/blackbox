// Reads Gherkin feature projects. It never imports Playwright or the step library.

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
