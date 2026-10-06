import GherkinCheck from './commands/gherkin/check.js';
import GherkinCheckChange from './commands/gherkin/check-change.js';
import GherkinCompile from './commands/gherkin/compile.js';
import GherkinSteps from './commands/gherkin/steps.js';

export const COMMANDS = {
  'gherkin:compile': GherkinCompile,
  'gherkin:check': GherkinCheck,
  'gherkin:check-change': GherkinCheckChange,
  'gherkin:steps': GherkinSteps,
};
