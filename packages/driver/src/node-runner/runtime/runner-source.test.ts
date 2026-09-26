import { expect, it } from 'vitest';

import { createNodeDriverRunnerSource } from './runner-source.js';

it('generates a static-import runner and rejects non-file modules', () => {
  const source = createNodeDriverRunnerSource({
    driverModuleUrl: new URL('file:///project/driver.mjs'),
    runnerModuleUrl: new URL('file:///package/node-runner.js'),
  });
  expect(source).toContain('import definition from "file:///project/driver.mjs";');
  expect(source).not.toContain('import(');
  expect(() =>
    createNodeDriverRunnerSource({
      driverModuleUrl: new URL('https://example.test/driver.mjs'),
      runnerModuleUrl: new URL('file:///package/node-runner.js'),
    }),
  ).toThrow('file: protocol');
});
