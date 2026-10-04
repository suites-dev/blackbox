import { expect, it } from 'vitest';

import { defineConfig } from './config.js';

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
  });
  expect(config.workers).toBe(3);
  expect(config.fullyParallel).toBe(true);
  expect(config.projects![0].use!.baseURL).toBe('https://example.test');
  expect(config.reporter).toEqual([['@suites/blackbox-playwright/reporter']]);
  expect(config).not.toHaveProperty('blackboxConfigFile');
});

it.each(['', '  '])('rejects an empty catalog config path: %j', (blackboxConfigFile) => {
  expect(() => defineConfig({ blackboxConfigFile })).toThrow('blackboxConfigFile must name');
});
