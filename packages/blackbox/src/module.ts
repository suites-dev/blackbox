import type { BlackboxModule } from '@suites/blackbox-cli-contract';

/** The default product composition; execution adapters are selected by the consumer. */
export const blackboxModule = {
  apiVersion: 1,
  dependencies: [
    '@suites/blackbox-catalog',
    '@suites/blackbox-discovery',
    '@suites/blackbox-skills',
  ],
} as const satisfies BlackboxModule;
