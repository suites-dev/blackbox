import repositoryConfig from '../eslint.config.mjs';

import e2eFunctionSize from './lint/e2e-function-size.mjs';

const e2eLintPlugin = {
  rules: {
    'function-size': e2eFunctionSize,
  },
};

export default [
  ...repositoryConfig,
  {
    files: ['tests/playwright/*.spec.ts'],
    plugins: {
      e2e: e2eLintPlugin,
    },
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'e2e/function-size': 'error',
    },
  },
];
