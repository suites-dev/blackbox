import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  businessCallbacks,
  compareStructure,
  executionSuite,
  skeleton,
  structure,
} from './structure.mjs';
import { verifyReport, verifySandboxes } from './proof.mjs';

const source = `import { expect, test } from '@suites/blackbox-playwright';
import { api } from './clients.js';
test.describe('default', () => {
  test.use({ blackbox: { system: 'example', clients: { api } } });
    test.describe('Feature: Example', { tag: ['@sync'] }, () => {
      test.beforeEach('Background: reset', async ({ clients, step }) => {
        await step('Given client "api" has sent POST "/fixture/reset" and received 200', () => { throw new Error('business setup ran'); });
      });
      test('Scenario: Example', async ({ clients, step }) => {
        const response = await step('When client "api" sends POST "/business"', () => clients.api.post('/business'));
        await step('Then the response status is 200', () => { expect(response.status()).toBe(200); });
      });
    });
});`;

test('skeleton preserves client acquisition declarations and step titles with empty business closures', async () => {
  const code = skeleton(source);
  assert.doesNotMatch(code, /business setup ran|\.post\(|response\.status/u);
  const [item] = await structure(code);
  assert.deepEqual(item.clients, ['api']);
  assert.equal(item.selection, 'example');
  assert.deepEqual(item.tags, ['@sync']);
  await assert.rejects(
    compareStructure(code.replace("system: 'example'", "system: 'wrong'"), source),
    /structure differs/u,
  );
  assert.deepEqual(item.backgrounds, [
    {
      title: 'Background: reset',
      steps: ['Given client "api" has sent POST "/fixture/reset" and received 200'],
    },
  ]);
  assert.deepEqual(item.steps, [
    'When client "api" sends POST "/business"',
    'Then the response status is 200',
  ]);
  await compareStructure(code, source);
  await assert.rejects(
    compareStructure(code.replace('Then the response status is 200', 'Then wrong'), source),
    /structure differs/u,
  );
  await assert.rejects(
    compareStructure(code.replace('clients: { api }', 'clients: { other: api }'), source),
    /structure differs/u,
  );
});

test('execution scaffold explicitly carries environment into the complete blackbox option', async () => {
  const sources = { FIXTURE_CONTROL_TOKEN: 'FIXTURE_CONTROL_TOKEN' };
  const execution = executionSuite(source, sources);
  const [plain] = await structure(source);
  const [configured] = await structure(execution);
  assert.deepEqual(plain.environment, {});
  assert.deepEqual(configured.environment, {
    FIXTURE_CONTROL_TOKEN: '<environment:FIXTURE_CONTROL_TOKEN>',
  });
  assert.equal(configured.selection, plain.selection);
  assert.deepEqual(configured.clients, plain.clients);
  assert.deepEqual(configured.steps, plain.steps);
  assert.match(execution, /process.env\["FIXTURE_CONTROL_TOKEN"\]/u);
  await assert.rejects(compareStructure(execution, source), /structure differs/u);
  assert.throws(
    () =>
      executionSuite(
        source.replace('clients: { api }', 'clients: { api }, environment: {}'),
        sources,
      ),
    /must not overwrite/u,
  );
});

test('explicit generated catalog kind survives native selection and rejects catalog drift', async () => {
  const explicit = source.replace("system: 'example'", "system: { kind: 'system', id: 'example' }");
  const catalog = [{ kind: 'system', id: 'example' }];
  const [selected] = await compareStructure(explicit, source, catalog);
  assert.deepEqual(selected.selection, { kind: 'system', id: 'example' });
  await assert.rejects(
    compareStructure(explicit, source, [{ kind: 'subsystem', id: 'example' }]),
    /Catalog kind mismatch/u,
  );
  await assert.rejects(
    compareStructure(explicit.replace("kind: 'system'", "kind: 'subsystem'"), source, catalog),
    /Catalog kind mismatch/u,
  );
});

test('report proof rejects zero discovery, missing steps, skipped cases, retries and collection errors', async () => {
  const model = await structure(source);
  const report = {
    errors: [],
    stats: { expected: 1, skipped: 0, flaky: 0, unexpected: 0 },
    suites: [
      {
        specs: [
          {
            id: 'example-id',
            title: 'Scenario: Example',
            tests: [
              {
                expectedStatus: 'passed',
                results: [
                  {
                    status: 'passed',
                    retry: 0,
                    steps: [
                      'When client "api" sends POST "/business"',
                      'Then the response status is 200',
                    ].map((title) => ({
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
      steps: [
        'Given client "api" has sent POST "/fixture/reset" and received 200',
        'When client "api" sends POST "/business"',
        'Then the response status is 200',
      ].map((title) => ({
        title,
        failed: false,
        assertions: title.startsWith('When') ? [] : [{ title: 'expect.toBe', failed: false }],
        requests: title.startsWith('Then')
          ? []
          : [
              {
                title: 'POST',
                subtitle: title.startsWith('Given') ? '/fixture/reset' : '/business',
                failed: false,
              },
            ],
      })),
    },
  ];
  assert.equal(verifyReport(report, model, live), 1);
  const emptyBusiness = structuredClone(live);
  for (const step of emptyBusiness[0].steps) {
    step.assertions = [];
    step.requests = [];
  }
  assert.throws(() => verifyReport(report, model, emptyBusiness), /did not execute/u);
  const wrongRequest = structuredClone(live);
  wrongRequest[0].steps[1].requests[0].subtitle = '/unrelated';
  assert.throws(() => verifyReport(report, model, wrongRequest), /Business request/u);
  const missingHook = structuredClone(live);
  missingHook[0].steps.shift();
  assert.throws(() => verifyReport(report, model, missingHook), /Live Background/);
  assert.throws(() => verifyReport(report, model, []), /live attempt count/);
  const mutants = [
    (copy) => {
      copy.suites[0].specs[0].tests[0].expectedStatus = 'failed';
    },
    (copy) => {
      copy.suites[0].specs[0].tests[0].results[0].retry = 1;
    },
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

test('execution transformation preserves actual business closures and detects erased semantics', () => {
  const execution = executionSuite(source, { TOKEN: 'TOKEN' });
  assert.deepEqual(businessCallbacks(execution), businessCallbacks(source));
  assert.match(execution, /business setup ran/u);
  assert.match(execution, /clients.api.post/u);
  assert.notDeepEqual(businessCallbacks(skeleton(source)), businessCallbacks(source));
  assert.notDeepEqual(
    businessCallbacks(execution.replace("'/business'", "'/wrong'")),
    businessCallbacks(source),
  );
  assert.notDeepEqual(
    businessCallbacks(execution.replace('toBe(200)', 'toBe(201)')),
    businessCallbacks(source),
  );
});
