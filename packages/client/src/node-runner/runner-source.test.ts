import { expect, it } from 'vitest';

import {
  createNodeClientInspectorSource,
  createNodeClientRunnerSource,
} from './runner-source.js';

const runnerModuleUrl = new URL('file:///blackbox/client-runner.js');

it('renders a static client import without dynamic import syntax', () => {
  const source = createNodeClientRunnerSource({
    clientModuleUrl: new URL('file:///project/.blackbox/clients/orders.mjs'),
    runnerModuleUrl,
  });

  expect(source).toContain(
    'import definition from "file:///project/.blackbox/clients/orders.mjs";',
  );
  expect(source).not.toContain('import(');
});

it('rejects a non-file module URL', () => {
  expect(() =>
    createNodeClientRunnerSource({
      clientModuleUrl: new URL('https://example.test/client.mjs'),
      runnerModuleUrl,
    }),
  ).toThrow('file: protocol');
});

it('keeps hostile path characters inside the static import string', () => {
  const source = createNodeClientRunnerSource({
    clientModuleUrl: new URL('file:///project/client.mjs?value=%22%3B%0Athrow%20new%20Error'),
    runnerModuleUrl,
  });

  expect(source.match(/^import /gmu)).toHaveLength(2);
  expect(source).not.toContain('\nthrow new Error');
  expect(source.split('\n')[0]).toMatch(/^import definition from "[^"]+";$/u);
});

it('renders an uninstrumented static inspector', () => {
  const source = createNodeClientInspectorSource({
    clientModuleUrl: new URL('file:///project/.blackbox/clients/orders.mjs'),
    runnerModuleUrl,
  });

  expect(source).toContain(
    'import definition from "file:///project/.blackbox/clients/orders.mjs";',
  );
  expect(source).toContain('inspectNodeClientDefinition');
  expect(source).not.toContain('runNodeClientProcess');
  expect(source).not.toContain('import(');
});

it('keeps hostile inspector path characters inside the static import string', () => {
  const source = createNodeClientInspectorSource({
    clientModuleUrl: new URL('file:///project/client.mjs?value=%22%3B%0Athrow%20new%20Error'),
    runnerModuleUrl,
  });

  expect(source.match(/^import /gmu)).toHaveLength(2);
  expect(source).not.toContain('\nthrow new Error');
  expect(source.split('\n')[0]).toMatch(/^import definition from "[^"]+";$/u);
});

it('rejects a non-file inspector module URL', () => {
  expect(() =>
    createNodeClientInspectorSource({
      clientModuleUrl: new URL('https://example.test/client.mjs'),
      runnerModuleUrl,
    }),
  ).toThrow('file: protocol');
});
