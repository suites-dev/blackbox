import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareStructure, skeleton, structure } from './structure.mjs';
import { verifyReport, verifySandboxes } from './proof.mjs';

const source = `import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';
test.system({ kind: 'system', id: 'example' }, (system) => {
  system.sandbox('default', { clients: { api } }, (suite) => {
    suite.describe('Feature: Example', { tag: ['@sync'] }, () => {
      suite.beforeEach('Background: reset', async ({ clients, step }) => {
        await step('Given setup', () => { throw new Error('business setup ran'); });
      });
      suite.test('Scenario: Example', async ({ clients, step }) => {
        const response = await step('When request', () => clients.api.post('/business'));
        await step('Then response', () => { expect(response.status()).toBe(200); });
      });
    });
  });
});`;

test('skeleton preserves client acquisition declarations and step titles with empty business closures', async () => {
  const code = skeleton(source);
  assert.doesNotMatch(code, /business setup ran|\.post\(|response\.status/u);
  const [item] = await structure(code);
  assert.deepEqual(item.clients, ['api']);
  assert.deepEqual(item.selection, { kind: 'system', id: 'example' });
  assert.deepEqual(item.tags, ['@sync']);
  assert.deepEqual(item.backgrounds, [{ title: 'Background: reset', steps: ['Given setup'] }]);
  assert.deepEqual(item.steps, ['When request', 'Then response']);
  await compareStructure(code, source);
  await assert.rejects(
    compareStructure(code.replace('Then response', 'Then wrong'), source),
    /structure differs/u,
  );
  await assert.rejects(
    compareStructure(code.replace('clients: { api }', 'clients: { other: api }'), source),
    /structure differs/u,
  );
});

test('report proof rejects zero discovery, missing steps, skipped cases, retries and collection errors', async () => {
  const model = await structure(source);
  const report = {
    errors: [],
    stats: { skipped: 0, flaky: 0, unexpected: 0 },
    suites: [
      {
        specs: [
          {
            id: 'example-id',
            title: 'Scenario: Example',
            tests: [
              {
                results: [
                  {
                    status: 'passed',
                    steps: ['When request', 'Then response'].map((title) => ({
                      title,
                    })),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const live = [
    {
      testId: 'example-id',
      retry: 0,
      status: 'passed',
      steps: ['Given setup', 'When request', 'Then response'].map((title) => ({
        title,
        failed: false,
      })),
    },
  ];
  assert.equal(verifyReport(report, model, live), 1);
  const missingHook = structuredClone(live);
  missingHook[0].steps.shift();
  assert.throws(() => verifyReport(report, model, missingHook), /Live Background/);
  assert.throws(() => verifyReport(report, model, []), /live attempt count/);
  const mutants = [
    (copy) => {
      copy.suites = [];
    },
    (copy) => {
      copy.suites[0].specs[0].tests[0].results[0].steps.pop();
    },
    (copy) => {
      copy.stats.skipped = 1;
    },
    (copy) => {
      copy.suites[0].specs[0].tests[0].results.push({ status: 'passed' });
    },
    (copy) => {
      copy.errors.push({ message: 'collection failed' });
    },
  ];
  for (const mutate of mutants) {
    const copy = structuredClone(report);
    mutate(copy);
    assert.throws(() => verifyReport(copy, model, live), assert.AssertionError);
  }
});

test('Sandbox proof rejects absent acquisitions, reused projects, incomplete teardown and live Docker resources', async () => {
  const records = [1, 2].map((id) => ({
    value: {
      sandboxId: `sandbox-${id}`,
      projectName: `project-${id}`,
      state: 'completed',
      cleanup: 'complete',
      stopReason: 'completed',
    },
  }));
  await verifySandboxes(records, 2, async () => []);
  await assert.rejects(
    verifySandboxes([], 2, async () => []),
    /physical Sandbox count/u,
  );
  const reused = structuredClone(records);
  reused[1].value.projectName = reused[0].value.projectName;
  await assert.rejects(
    verifySandboxes(reused, 2, async () => []),
    /projects were reused/u,
  );
  const leaked = structuredClone(records);
  leaked[0].value.cleanup = 'incomplete';
  await assert.rejects(
    verifySandboxes(leaked, 2, async () => []),
    /cleanup was incomplete/u,
  );
  await assert.rejects(
    verifySandboxes(records, 2, async () => ['live-container']),
    /Docker resources remain/u,
  );
});
