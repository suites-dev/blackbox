import FeatureCheck from './commands/feature/check.js';
import FeatureCheckChange from './commands/feature/check-change.js';
import FeatureCompile from './commands/feature/compile.js';
import FeatureSteps from './commands/feature/steps.js';
import FeatureVerify from './commands/feature/verify.js';

export const COMMANDS = {
  'feature:compile': FeatureCompile,
  'feature:check': FeatureCheck,
  'feature:check-change': FeatureCheckChange,
  'feature:verify': FeatureVerify,
  'feature:steps': FeatureSteps,
};
