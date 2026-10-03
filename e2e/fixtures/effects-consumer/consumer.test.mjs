import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { compileEffectContract, evaluateEffects, projectEffects } from '@suites/blackbox-effects';

const observation = JSON.parse(readFileSync(new URL('./observations.json', import.meta.url)));
const project = (payloads = [observation]) =>
  projectEffects({ format: 'otlp-json', scopeId: 'packed-consumer', payloads });
const assess = (callback, graph = project()) =>
  evaluateEffects(graph, compileEffectContract(callback));

function assertDeepFrozen(value) {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value), 'public JSON value must be immutable');
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
}

test('public package resolves inside the standalone consumer without Playwright', () => {
  const require = createRequire(import.meta.url);
  const entrypoint = realpathSync(fileURLToPath(import.meta.resolve('@suites/blackbox-effects')));
  const consumer = realpathSync(fileURLToPath(new URL('.', import.meta.url)));
  assert.ok(relative(consumer, entrypoint).startsWith(`node_modules${sep}`));
  assert.ok(entrypoint.includes(`${sep}dist${sep}`), 'runtime export must use packaged dist');
  for (const name of ['@playwright/test', 'playwright', '@suites/blackbox-playwright']) {
    assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
  }
  assert.throws(() => require.resolve('@suites/blackbox-effects/src/index.ts'), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  });
});

test('structured database and messaging evidence passes through all three public functions', () => {
  const graph = project();
  const contract = compileEffectContract((e) => [
    e.exists(e.db({ operation: 'SELECT' })),
    e.exists(e.message({ operation: 'send', destination: 'jobs' })),
    e.exists(e.message({ operation: 'process', destination: 'jobs' })),
  ]);
  const result = evaluateEffects(graph, contract);
  assert.equal(result.status, 'pass');
  assert.equal(result.scope, 'packed-consumer');
  assert.equal(result.semanticsVersion, '0.1.0');
  assert.equal(result.findings.length, 3);
  assert.ok(result.findings.every((finding) => finding.evidence.length > 0));
  for (const value of [graph, contract, result]) assertDeepFrozen(value);
});

test('observed forbidden effect fails', () => {
  assert.equal(assess((e) => [e.absent(e.db({ operation: 'SELECT' }))]).status, 'fail');
});

test('absence without observation remains inconclusive', () => {
  assert.equal(assess((e) => [e.absent(e.db({ operation: 'DELETE' }))]).status, 'inconclusive');
});

test('matching exact count remains inconclusive without completeness', () => {
  assert.equal(assess((e) => [e.exactly(1, e.db({ operation: 'SELECT' }))]).status, 'inconclusive');
});

test('span display name and SQL text do not supply a missing operation', () => {
  const missing = structuredClone(observation);
  const spans = missing.resourceSpans[0].scopeSpans[0].spans;
  spans.splice(1);
  spans[0].name = 'DELETE important_table';
  spans[0].attributes = [
    { key: 'db.system.name', value: { stringValue: 'postgresql' } },
    { key: 'db.query.text', value: { stringValue: 'DELETE FROM important_table' } },
  ];
  assert.equal(
    assess((e) => [e.exists(e.db({ operation: 'DELETE' }))], project([missing])).status,
    'inconclusive',
  );
});

test('malformed operation evidence is rejected instead of becoming a passing graph', () => {
  const malformed = structuredClone(observation);
  malformed.resourceSpans[0].scopeSpans[0].spans[0].attributes[1].value = { intValue: 42 };
  assert.throws(() => project([malformed]), TypeError);
  assert.throws(() => project([{}]), TypeError);
});

test('consumer mutation cannot change the compiled contract', () => {
  const fields = { operation: 'SELECT' };
  const contract = compileEffectContract((e) => [e.exists(e.db(fields))]);
  fields.operation = 'DELETE';
  assert.equal(evaluateEffects(project(), contract).status, 'pass');
  assert.throws(() => contract.constraints.push({}), TypeError);
});
