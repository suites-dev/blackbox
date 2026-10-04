import { defineConfig as playwrightConfig, type PlaywrightTestConfig } from '@playwright/test';

import { sandboxLifecycleConfigured, sandboxLifecycleMetadataKey } from './reporting/options.js';
import { expectTimeoutsMetadataKey } from './reporting/policy/manifest.js';

export type BlackboxPlaywrightConfig = PlaywrightTestConfig & {
  readonly blackboxConfigFile: string;
};

// Playwright's documented default for expect.timeout.
const defaultExpectTimeoutMs = 5000;

function expectTimeoutOf(expect: PlaywrightTestConfig['expect'], fallback: number): number {
  return expect === undefined || expect.timeout === undefined ? fallback : expect.timeout;
}

/**
 * Reporters see FullProject, which omits expect.timeout. Record the configured
 * value per project name so the runner-policy manifest can surface it.
 */
function expectTimeouts(config: PlaywrightTestConfig): Record<string, number> {
  const configured = expectTimeoutOf(config.expect, defaultExpectTimeoutMs);
  const projects = config.projects ?? [{}];
  return Object.fromEntries(
    projects.map((project) => [project.name ?? '', expectTimeoutOf(project.expect, configured)]),
  );
}

/** Keep the catalog location in runner configuration, outside test.use(). */
export function defineConfig(input: BlackboxPlaywrightConfig) {
  const { blackboxConfigFile, ...config } = input;
  if (typeof blackboxConfigFile !== 'string' || blackboxConfigFile.trim().length === 0) {
    throw new Error('blackboxConfigFile must name the project Blackbox configuration file');
  }
  return playwrightConfig({
    ...config,
    metadata: {
      ...config.metadata,
      blackboxConfigFile,
      [sandboxLifecycleMetadataKey]: sandboxLifecycleConfigured(config.reporter),
      [expectTimeoutsMetadataKey]: expectTimeouts(config),
    },
  });
}
