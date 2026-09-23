import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import {
  EXTERNAL_REQUIRED_CONTEXTS,
  GATE_CONTEXT,
  INFORMATIONAL_CONTEXTS,
  REQUIRED_LANES,
  buildReceipt,
  decorateWithLinks,
  evaluateGate,
  main,
  normalizeNeedsResult,
  parseNeeds,
  renderSummary,
} from './pr-gate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(here, 'pr-gate.mjs');
const ciWorkflowPath = path.join(here, '..', 'workflows', 'ci.yml');
const proofWorkflowPath = path.join(here, '..', 'workflows', 'pr-gate-proof.yml');

function allSuccess() {
  return Object.fromEntries(REQUIRED_LANES.map((lane) => [lane.id, { result: 'success' }]));
}

const context = {
  token: '',
  apiUrl: 'https://api.example.test',
  serverUrl: 'https://github.example.test',
  repository: 'suites-dev/blackbox',
  runId: '1',
  runAttempt: '1',
  headSha: 'abc123',
  now: '2026-09-21T00:00:00.000Z',
};

test('every required lane succeeding passes the gate', () => {
  const evaluation = evaluateGate(allSuccess());
  assert.equal(evaluation.verdict, 'success');
  assert.deepEqual(evaluation.failed, []);
  assert.deepEqual(evaluation.unexpected, []);
  assert.equal(evaluation.lanes.length, REQUIRED_LANES.length);
});

test('controlled matrix: failure, cancellation, skip, invalid, and missing each fail the gate', () => {
  for (const lane of REQUIRED_LANES) {
    for (const result of ['failure', 'cancelled', 'skipped', 'timed_out', '', undefined]) {
      const needs = allSuccess();
      needs[lane.id] = { result };
      const evaluation = evaluateGate(needs);
      assert.equal(
        evaluation.verdict,
        'failure',
        `${lane.id} with result ${JSON.stringify(result)} must fail the gate`,
      );
      assert.deepEqual(
        evaluation.failed.map((entry) => entry.id),
        [lane.id],
        `${lane.id} must be the only failed lane`,
      );
    }

    const missing = allSuccess();
    delete missing[lane.id];
    const evaluation = evaluateGate(missing);
    assert.equal(evaluation.verdict, 'failure', `missing ${lane.id} must fail the gate`);
    assert.deepEqual(evaluation.failed, [{ id: lane.id, context: lane.context, result: 'missing' }]);
  }
});

test('a skipped dependency can never pass, even when every other lane succeeded', () => {
  const needs = allSuccess();
  needs.test = { result: 'skipped' };
  const evaluation = evaluateGate(needs);
  assert.equal(evaluation.verdict, 'failure');
  assert.equal(evaluation.lanes.find((lane) => lane.id === 'test').result, 'skipped');
});

test('empty, null, non-object, and entirely missing needs fail closed', () => {
  for (const needs of [null, undefined, {}, [], 'success', 42]) {
    const evaluation = evaluateGate(needs);
    assert.equal(evaluation.verdict, 'failure', `needs ${JSON.stringify(needs)} must fail`);
    assert.equal(evaluation.failed.length, REQUIRED_LANES.length);
  }
  assert.equal(evaluateGate(allSuccess(), { requiredLanes: [] }).verdict, 'failure');
});

test('unexpected needs entries are reported and ignored by the verdict', () => {
  const needs = { ...allSuccess(), 'e2e-informational': { result: 'failure' } };
  const evaluation = evaluateGate(needs);
  assert.equal(evaluation.verdict, 'success');
  assert.deepEqual(evaluation.unexpected, ['e2e-informational']);
});

test('needs results are normalized case-insensitively and unknown values are marked invalid', () => {
  assert.equal(normalizeNeedsResult(' Success '), 'success');
  assert.equal(normalizeNeedsResult('CANCELLED'), 'cancelled');
  assert.equal(normalizeNeedsResult('timed_out'), 'invalid:timed_out');
  assert.equal(normalizeNeedsResult(''), 'missing');
  assert.equal(normalizeNeedsResult(undefined), 'missing');
  assert.equal(normalizeNeedsResult(7), 'missing');
});

test('parseNeeds accepts the toJSON(needs) shape and rejects non-objects', () => {
  assert.deepEqual(parseNeeds('{"build":{"result":"success","outputs":{}}}'), {
    build: { result: 'success', outputs: {} },
  });
  assert.equal(parseNeeds(''), null);
  assert.equal(parseNeeds(undefined), null);
  assert.equal(parseNeeds('"success"'), null);
  assert.throws(() => parseNeeds('{not json'), SyntaxError);
});

test('required lane ids, names, and the gate needs list match ci.yml exactly', () => {
  const workflow = YAML.parse(readFileSync(ciWorkflowPath, 'utf8'));
  for (const lane of REQUIRED_LANES) {
    const job = workflow.jobs[lane.id];
    assert.ok(job, `ci.yml must define job "${lane.id}"`);
    const [workflowName, ...rest] = lane.context.split(' / ');
    assert.equal(job.name, workflowName, `job "${lane.id}" must be named "${workflowName}"`);
    assert.doesNotMatch(String(job.name), /\$\{\{/, `required job "${lane.id}" must not carry matrix values`);
    if (rest.length > 0) {
      assert.ok(job.uses, `job "${lane.id}" must be a reusable workflow for context "${lane.context}"`);
      const reusablePath = path.join(here, '..', '..', job.uses.replace(/^\.\//, ''));
      const reusable = YAML.parse(readFileSync(reusablePath, 'utf8'));
      const innerNames = Object.values(reusable.jobs).map((inner) => inner.name);
      assert.ok(
        innerNames.includes(rest.join(' / ')),
        `reusable workflow ${job.uses} must define a job named "${rest.join(' / ')}"`,
      );
    }
  }

  const gate = workflow.jobs.gate;
  assert.ok(gate, 'ci.yml must define the gate job');
  assert.equal(gate.name, GATE_CONTEXT);
  assert.equal(gate.if, 'always()', 'gate must run on every dependency result');
  assert.deepEqual([...gate.needs].sort(), REQUIRED_LANES.map((lane) => lane.id).sort());
  assert.ok(
    gate.steps.some(
      (step) => typeof step.run === 'string' && step.run.includes('pr-gate.mjs evaluate'),
    ),
    'gate must run the aggregator',
  );
  const evaluateStep = gate.steps.find(
    (step) => typeof step.run === 'string' && step.run.includes('pr-gate.mjs evaluate'),
  );
  assert.equal(evaluateStep.env.PR_GATE_NEEDS, '${{ toJSON(needs) }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
});

test('external and informational context names are not folded into the required set', () => {
  const required = new Set(REQUIRED_LANES.map((lane) => lane.context));
  for (const name of [...EXTERNAL_REQUIRED_CONTEXTS, ...INFORMATIONAL_CONTEXTS]) {
    assert.ok(!required.has(name), `${name} must not be a required lane`);
  }
  assert.ok(INFORMATIONAL_CONTEXTS.includes('Harness E2E (testcontainers)'));
});

test('the proof workflow covers passing, failing, cancelled, skipped, and missing scenarios', () => {
  const workflow = YAML.parse(readFileSync(proofWorkflowPath, 'utf8'));
  const job = workflow.jobs['controlled-proof'];
  const scenarios = job.strategy.matrix.scenario;
  assert.deepEqual(scenarios, ['passing', 'failing', 'cancelled', 'skipped', 'missing']);
  assert.equal(job.strategy['fail-fast'], false);
  assert.ok(workflow.on.pull_request, 'proof must run on pull requests that touch the gate');
  assert.ok('workflow_dispatch' in workflow.on, 'proof must stay manually dispatchable');
  const fixtures = path.join(here, 'pr-gate-fixtures');
  for (const name of scenarios) {
    const needs = JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), 'utf8'));
    const expected = name === 'passing' ? 'success' : 'failure';
    assert.equal(evaluateGate(needs).verdict, expected, `fixture ${name} must evaluate to ${expected}`);
  }
});

test('summary and receipt carry every lane, links when resolved, and notes when not', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url.includes('/jobs')) {
      return {
        ok: true,
        json: async () => ({
          jobs: REQUIRED_LANES.map((lane, index) => ({
            name: lane.context,
            html_url: `https://jobs.example.test/${String(index)}`,
            status: 'completed',
            conclusion: 'success',
          })),
        }),
      };
    }
    if (url.includes('/artifacts')) {
      return {
        ok: true,
        json: async () => ({
          artifacts: [{ id: 9, name: 'ci-evidence-1-1-test-merged', size_in_bytes: 10 }],
        }),
      };
    }
    if (url.includes('/check-runs')) {
      return {
        ok: true,
        json: async () => ({
          check_runs: [
            {
              name: 'Harness E2E (testcontainers)',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://checks.example.test/e2e',
            },
            { name: 'Unrelated', status: 'completed', conclusion: 'success', html_url: 'x' },
          ],
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  const report = await decorateWithLinks(
    evaluateGate(allSuccess()),
    { ...context, token: 'token' },
    { fetch: fetchImpl },
  );
  assert.equal(fetchCalls.length, 3);
  assert.equal(report.verdict, 'success');
  assert.deepEqual(report.notes, []);
  assert.equal(report.informational.length, 1);
  const summary = renderSummary(report, context);
  for (const lane of REQUIRED_LANES) {
    assert.ok(summary.includes(`| ${lane.context} |`), `summary must list ${lane.context}`);
  }
  assert.ok(summary.includes('https://jobs.example.test/0'));
  assert.ok(summary.includes('actions/runs/1/artifacts/9'));
  assert.ok(summary.includes('[Harness E2E (testcontainers)](https://checks.example.test/e2e): `failure`'));
  assert.ok(summary.startsWith(`## ${GATE_CONTEXT}: pass`));

  const receipt = buildReceipt(report, context);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.verdict, 'success');
  assert.equal(receipt.requiredLanes.length, REQUIRED_LANES.length);
  assert.equal(receipt.requiredLanes[0].jobUrl, 'https://jobs.example.test/0');
  assert.equal(receipt.informational[0].conclusion, 'failure');
  assert.equal(receipt.generatedAt, context.now);
});

test('an informational failure never changes the verdict and API failures only add notes', async () => {
  const failingFetch = async () => ({ ok: false, status: 500 });
  const report = await decorateWithLinks(
    evaluateGate(allSuccess()),
    { ...context, token: 'token' },
    { fetch: failingFetch },
  );
  assert.equal(report.verdict, 'success');
  assert.equal(report.notes.length, 3);
  const summary = renderSummary(report, context);
  assert.ok(summary.includes('link unavailable'));
  assert.ok(summary.includes('### Notes'));

  const withoutToken = await decorateWithLinks(evaluateGate(allSuccess()), context, {
    fetch: failingFetch,
  });
  assert.deepEqual(withoutToken.notes, [
    'GITHUB_TOKEN was not available; job and artifact links were not resolved.',
  ]);
});

test('the CLI exits 0 on success and 1 on any required failure, writing receipt and summary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pr-gate-'));
  try {
    const summaryPath = path.join(root, 'step-summary.md');
    const outputPath = path.join(root, 'output.txt');
    const receiptPath = path.join(root, 'evidence', 'receipt.json');
    await writeFile(summaryPath, '');
    await writeFile(outputPath, '');
    const environment = {
      PR_GATE_NEEDS: JSON.stringify(allSuccess()),
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_OUTPUT: outputPath,
      GITHUB_REPOSITORY: 'suites-dev/blackbox',
      GITHUB_RUN_ID: '77',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_SHA: 'deadbeef',
    };
    const sink = { write() {} };
    assert.equal(await main(['evaluate', '--receipt', receiptPath], environment, { stdout: sink }), 0);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.verdict, 'success');
    assert.equal(receipt.runId, '77');
    assert.equal(receipt.headSha, 'deadbeef');
    assert.match(await readFile(summaryPath, 'utf8'), /## PR Gate: pass/);
    assert.match(await readFile(outputPath, 'utf8'), /^verdict=success$/m);
    assert.match(await readFile(path.join(root, 'evidence', 'summary.md'), 'utf8'), /Required lanes/);

    const needsFile = path.join(root, 'needs.json');
    const failing = allSuccess();
    failing.deps = { result: 'cancelled' };
    await writeFile(needsFile, JSON.stringify(failing));
    assert.equal(
      await main(['evaluate', '--needs-file', needsFile, '--receipt', receiptPath], environment, {
        stdout: sink,
      }),
      1,
    );
    const failed = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.deepEqual(failed.failed, [
      { id: 'deps', context: 'Dependency Boundaries', result: 'cancelled' },
    ]);

    await assert.rejects(main(['nope'], environment, { stdout: sink }), /Unknown command/);
    await assert.rejects(main(['evaluate', '--bogus'], environment, { stdout: sink }), /Unknown argument/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the script runs as a process and propagates the failing exit code', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pr-gate-proc-'));
  try {
    const env = {
      ...process.env,
      GITHUB_TOKEN: '',
      PR_GATE_NEEDS: JSON.stringify({ build: { result: 'success' } }),
      PR_GATE_RECEIPT: path.join(root, 'receipt.json'),
      GITHUB_STEP_SUMMARY: '',
      GITHUB_OUTPUT: '',
    };
    let status = 0;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [scriptPath, 'evaluate'], { env, encoding: 'utf8' });
    } catch (error) {
      status = error.status;
      stdout = error.stdout;
    }
    assert.equal(status, 1);
    assert.match(stdout, /## PR Gate: FAIL/);
    assert.match(stdout, /`missing`/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
