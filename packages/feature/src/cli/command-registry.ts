import {
  FeatureSuiteEmit,
  FeatureFileValidate,
  FeatureStepList,
  FeatureSuiteValidate,
  FeatureRunVerify,
  FeatureFileDraft,
} from './feature-commands.js';

export const COMMANDS = {
  'feature:file:draft': FeatureFileDraft,
  'feature:step:list': FeatureStepList,
  'feature:file:validate': FeatureFileValidate,
  'feature:suite:validate': FeatureSuiteValidate,
  'feature:suite:emit': FeatureSuiteEmit,
  'feature:run:verify': FeatureRunVerify,
};

export const ROOT_HELP_ORDER: readonly string[] = Object.keys(COMMANDS);
