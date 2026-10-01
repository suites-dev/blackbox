import { defineConfig as playwrightConfig, type PlaywrightTestConfig } from '@playwright/test';

import type { BlackboxTestOptions } from './types.js';

export type BlackboxPlaywrightConfig = PlaywrightTestConfig<BlackboxTestOptions> & {
  readonly blackboxConfigFile: string;
};

/** Keep the catalog location in runner configuration, outside test.use(). */
export function defineConfig(input: BlackboxPlaywrightConfig) {
  const { blackboxConfigFile, ...config } = input;
  if (typeof blackboxConfigFile !== 'string' || blackboxConfigFile.trim().length === 0) {
    throw new Error('blackboxConfigFile must name the project Blackbox configuration file');
  }
  return playwrightConfig<BlackboxTestOptions>({
    ...config,
    metadata: { ...config.metadata, blackboxConfigFile },
  });
}
