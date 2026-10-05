import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

import { defineConfig } from './config.js';

function lifecycleMetadata(config: ReturnType<typeof defineConfig>): unknown {
  if (config.metadata === undefined) {
    throw new Error('Expected Blackbox config metadata');
  }
  return config.metadata.blackboxSandboxLifecycle;
}

it('keeps native projects and settings while moving the catalog path into runner metadata', () => {
  const config = defineConfig({
    blackboxConfigFile: './catalog/blackbox.yaml',
    metadata: { owner: 'orders' },
    workers: 3,
    fullyParallel: true,
    projects: [{ name: 'systems', use: { baseURL: 'https://example.test' } }],
    reporter: [['@suites/blackbox-playwright/reporter']],
  });
  expect(config.metadata).toEqual({
    owner: 'orders',
    blackboxConfigFile: './catalog/blackbox.yaml',
    blackboxSandboxLifecycle: true,
  });
  expect(config.workers).toBe(3);
  expect(config.fullyParallel).toBe(true);
  expect(config.projects![0].use!.baseURL).toBe('https://example.test');
  expect(config.reporter).toEqual([['@suites/blackbox-playwright/reporter']]);
  expect(config).not.toHaveProperty('blackboxConfigFile');
});

it('normalizes package and source-path reporter options', () => {
  const lifecycle = (reporter: Parameters<typeof defineConfig>[0]['reporter']) =>
    lifecycleMetadata(defineConfig({ blackboxConfigFile: './blackbox.yaml', reporter }));
  const sourceReporter = fileURLToPath(new URL('./reporter.ts', import.meta.url));

  expect(lifecycle('@suites/blackbox-playwright/reporter')).toBe(true);
  expect(lifecycle([['@suites/blackbox-playwright/reporter', { sandboxLifecycle: true }]])).toBe(
    true,
  );
  expect(lifecycle([['@suites/blackbox-playwright/reporter', { sandboxLifecycle: false }]])).toBe(
    false,
  );
  expect(lifecycle([[sourceReporter]])).toBe(true);
  expect(lifecycle([[sourceReporter, { sandboxLifecycle: false }]])).toBe(false);
  expect(lifecycle('list')).toBe(false);
  expect(lifecycle(undefined)).toBe(false);
});

it('does not retain reporter options across config declarations', () => {
  const disabled = defineConfig({
    blackboxConfigFile: './first.yaml',
    reporter: [['@suites/blackbox-playwright/reporter', { sandboxLifecycle: false }]],
  });
  const enabled = defineConfig({
    blackboxConfigFile: './second.yaml',
    reporter: [['@suites/blackbox-playwright/reporter']],
  });
  expect(lifecycleMetadata(disabled)).toBe(false);
  expect(lifecycleMetadata(enabled)).toBe(true);
});

it('rejects invalid lifecycle options for the package reporter', () => {
  expect(() =>
    defineConfig({
      blackboxConfigFile: './blackbox.yaml',
      reporter: [['@suites/blackbox-playwright/reporter', { sandboxLifecycle: 'false' }]],
    }),
  ).toThrow('must be a boolean');
});

it.each(['', '  '])('rejects an empty catalog config path: %j', (blackboxConfigFile) => {
  expect(() => defineConfig({ blackboxConfigFile })).toThrow('blackboxConfigFile must name');
});
