import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import rule from './e2e-function-size.mjs';

const linter = new Linter({ configType: 'flat' });
const configuration = {
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: { e2e: { rules: { 'function-size': rule } } },
  rules: { 'e2e/function-size': 'error' },
};

function callback(codeLines, options = {}) {
  const prefix = options.async === true ? 'async ' : '';
  const body = Array.from({ length: codeLines - 2 }, () => 'value;').join('\n');
  return `${prefix}() => {\n${body}\n}`;
}

function messages(source) {
  return linter.verify(source, configuration, { filename: 'journey.spec.js' });
}

test('allows long direct synchronous Blackbox suite declaration callbacks', () => {
  const sources = [
    `test.system('suite', ${callback(100)});`,
    `system.sandbox('suite', ${callback(100)});`,
    `system.sandbox('suite', {}, ${callback(100)});`,
    `sandbox.describe('suite', ${callback(100)});`,
    `suite.describe('suite', ${callback(100)});`,
  ];
  for (const source of sources) {
    assert.deepEqual(messages(source), []);
  }
});

test('rejects oversized tests, steps, hooks, and helper functions', () => {
  const sources = [
    `test('journey', ${callback(81, { async: true })});`,
    `sandbox.test('journey', ${callback(81, { async: true })});`,
    `test.step('action', ${callback(81, { async: true })});`,
    `sandbox.beforeEach(${callback(81, { async: true })});`,
    `sandbox.afterEach(${callback(81, { async: true })});`,
    `function helper() {\n${'value;\n'.repeat(79)}}`,
  ];
  for (const source of sources) {
    assert.equal(messages(source).filter(({ ruleId }) => ruleId === 'e2e/function-size').length, 1);
  }
});

test('still rejects an oversized test nested inside an exempt suite callback', () => {
  const source = `test.system('orders', () => {\nsandbox.test('journey', ${callback(81)});\n});`;
  assert.equal(messages(source).filter(({ ruleId }) => ruleId === 'e2e/function-size').length, 1);
});

test('rejects unrelated describe, async suite, and callback in the wrong position', () => {
  const sources = [
    `test.describe('suite', ${callback(81)});`,
    `test.system('suite', ${callback(81, { async: true })});`,
    `system.sandbox('suite', ${callback(81, { async: true })});`,
    `sandbox.describe('suite', ${callback(81, { async: true })});`,
    `suite.describe('suite', ${callback(81, { async: true })});`,
    `test.system(${callback(81)}, 'suite');`,
  ];
  for (const source of sources) {
    assert.equal(messages(source).filter(({ ruleId }) => ruleId === 'e2e/function-size').length, 1);
  }
});

test('counts token-covered lines and ignores comments and blank lines at the boundary', () => {
  const eighty = callback(80);
  const eightyOne = callback(81);
  const padded = eighty.replace('{\n', `{\n${'// comment\n\n'.repeat(40)}`);
  assert.deepEqual(messages(`test('boundary', ${eighty});`), []);
  assert.deepEqual(messages(`test('padded', ${padded});`), []);
  assert.equal(
    messages(`test('over', ${eightyOne});`).filter(({ ruleId }) => ruleId === 'e2e/function-size')
      .length,
    1,
  );
});
