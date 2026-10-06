import { dirname } from 'node:path';

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
  {
    // The private Gherkin preview is a dependency of the workspace root, not of
    // this manifest: the CLI journeys run the Blackbox CLI here, and it loads
    // the command packages this manifest lists.
    files: ['playwright.gherkin.config.ts'],
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: true, packageDir: [import.meta.dirname, dirname(import.meta.dirname)] },
      ],
    },
  },
];
