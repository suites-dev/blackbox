import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { expectedCatalogForSpec } from './playwright-evidence.mjs';
import { verifyAttemptReports, verifyParallelAcquisition } from './playwright-report-proof.mjs';

function parallelAcquisitions() {
  return {
    attempts: [
      {
        file: 'payments.spec.ts',
        workerIndex: 0,
        acquisitionStartedAt: 0,
        acquisitionCompletedAt: 10,
      },
      {
        file: 'payments.spec.ts',
        workerIndex: 1,
        acquisitionStartedAt: 1,
        acquisitionCompletedAt: 11,
      },
      {
        file: 'subscriptions.spec.ts',
        workerIndex: 0,
        acquisitionStartedAt: 10,
        acquisitionCompletedAt: 20,
      },
    ],
  };
}

test('requires overlapping sandbox acquisition both within and across files', () => {
  verifyParallelAcquisition(parallelAcquisitions());
  const serial = parallelAcquisitions();
  serial.attempts.forEach((attempt, index) => {
    attempt.acquisitionStartedAt = index * 10;
    attempt.acquisitionCompletedAt = (index + 1) * 10;
  });
  assert.throws(() => verifyParallelAcquisition(serial), /within a test file/);
  const acrossOnly = parallelAcquisitions();
  acrossOnly.attempts[1].file = 'orders.spec.ts';
  assert.throws(() => verifyParallelAcquisition(acrossOnly), /within a test file/);
  const withinOnly = parallelAcquisitions();
  withinOnly.attempts[2].file = 'payments.spec.ts';
  assert.throws(() => verifyParallelAcquisition(withinOnly), /across test files/);
});

test('rejects worker reuse and missing acquisition timings as parallel evidence', () => {
  const oneWorker = parallelAcquisitions();
  oneWorker.attempts.forEach((attempt) => {
    attempt.workerIndex = 0;
  });
  assert.throws(() => verifyParallelAcquisition(oneWorker), /within a test file/);
  const missing = parallelAcquisitions();
  missing.attempts[0].acquisitionStartedAt = null;
  assert.throws(() => verifyParallelAcquisition(missing), /within a test file/);
});

test('attributes business specs to their catalog', () => {
  assert.deepEqual(expectedCatalogForSpec('/consumer/tests/playwright/payment-service.spec.ts'), {
    kind: 'subsystem',
    id: 'payment-mock',
  });
  assert.deepEqual(
    expectedCatalogForSpec('/consumer/tests/playwright/subscription-system.spec.ts'),
    { kind: 'system', id: 'subscription-system' },
  );
  assert.equal(
    expectedCatalogForSpec('/consumer/tests/playwright/effects-acceptance.spec.ts'),
    undefined,
  );
});

function fixture(suffix = 'a', testId = `test-${suffix}`, retry = 0) {
  const owner = {
    testId,
    retry,
    workerIndex: 0,
    parallelIndex: 0,
    outputDirectory: `/output/${suffix}`,
  };
  const document = {
    schemaVersion: 1,
    owner,
    identity: {
      kind: 'acquired',
      sandboxId: `run-${suffix}`,
      executionId: `run-${suffix}`,
      sessionId: `session-${suffix}`,
      catalogEntry: { kind: 'system', id: 'subscription-system' },
    },
    events: [
      'catalog',
      'acquisition',
      'instrumentation',
      'readiness',
      'sandbox',
      'teardown',
      'collector',
    ].map((phase) => ({ phase, status: 'completed', detail: '' })),
  };
  document.events.push({
    phase: 'observations',
    status: 'info',
    detail: '3 requests; 21 spans; 2 traces',
  });
  return {
    document,
    input: {
      attempts: [
        {
          ...owner,
          expectedCatalog: { ...document.identity.catalogEntry },
          stdout: [{ text: 'consumer output\n' }],
          attachments: [
            {
              name: 'blackbox-attempt',
              body: Buffer.from(JSON.stringify(document)).toString('base64'),
            },
            {
              name: 'blackbox-diagnostics',
              body: Buffer.from('retained lifecycle').toString('base64'),
            },
          ],
        },
      ],
      records: [
        {
          recordDirectory: `/output/${suffix}/blackbox`,
          value: { sandboxId: `run-${suffix}`, cleanup: 'complete' },
        },
      ],
      live: {
        errors: [],
        attempts: [
          {
            ...owner,
            sandboxId: `run-${suffix}`,
            acquisitionStartedAt: 120,
            acquisitionCompletedAt: 300,
            lifecycleSteps: [
              {
                title: 'Start sandbox',
                sequence: 0,
                startedAt: '2026-10-04T00:00:00.000Z',
                startedAtMonotonic: 100,
                completedAtMonotonic: 400,
                duration: 300,
                status: 'completed',
                error: null,
              },
              {
                title: 'Clean up sandbox',
                sequence: 1,
                startedAt: '2026-10-04T00:00:00.800Z',
                startedAtMonotonic: 800,
                completedAtMonotonic: 900,
                duration: 100,
                status: 'completed',
                error: null,
              },
            ],
          },
        ],
      },
      text: 'Then And\n1 passed (1s)',
    },
  };
}

test('accepts matched live, retained and Docker cleanup evidence', () => {
  const { input } = fixture();
  assert.equal(verifyAttemptReports(input).attempts.length, 1);
});

function pair(sameTest = false) {
  const first = fixture('a', 'first', 0).input;
  const second = fixture('b', sameTest ? 'first' : 'second', sameTest ? 1 : 0).input;
  return {
    attempts: [...first.attempts, ...second.attempts],
    records: [...first.records, ...second.records],
    live: { errors: [], attempts: [...first.live.attempts, ...second.live.attempts] },
    text: `${first.text}\n${second.text}`,
  };
}

for (const sameTest of [false, true]) {
  test(`rejects swapped attachments across ${sameTest ? 'retries' : 'tests'}`, () => {
    const input = pair(sameTest);
    assert.equal(verifyAttemptReports(input).attempts.length, 2);
    const [first, second] = input.attempts;
    [first.attachments, second.attachments] = [second.attachments, first.attachments];
    assert.throws(() => verifyAttemptReports(input), /different Playwright attempt/);
  });
}

test('rejects swapped live sandbox attribution even when retained reports are valid', () => {
  const input = pair();
  const [first, second] = input.live.attempts;
  [first.sandboxId, second.sandboxId] = [second.sandboxId, first.sandboxId];
  assert.throws(() => verifyAttemptReports(input), /Live report belongs/);
});

test('rejects missing live attempts disguised by duplicate counts', () => {
  const input = pair();
  input.live.attempts[1] = input.live.attempts[0];
  assert.throws(() => verifyAttemptReports(input), /Live report belongs/);
});

test('rejects another scenario catalog, worker identity, or output record', () => {
  const catalog = fixture().input;
  catalog.attempts[0].expectedCatalog = { kind: 'subsystem', id: 'payment-mock' };
  assert.throws(() => verifyAttemptReports(catalog), /catalog does not match/);
  const worker = fixture().input;
  worker.attempts[0].workerIndex++;
  assert.throws(() => verifyAttemptReports(worker), /different Playwright attempt/);
  const output = fixture().input;
  output.records[0].recordDirectory = '/output/another-attempt/blackbox';
  assert.throws(() => verifyAttemptReports(output), /owning attempt output directory/);
});

for (const phase of [
  'catalog',
  'acquisition',
  'instrumentation',
  'readiness',
  'sandbox',
  'teardown',
  'collector',
]) {
  test(`rejects a report falsely omitting ${phase}`, () => {
    const { input, document } = fixture();
    document.events = document.events.filter((event) => event.phase !== phase);
    input.attempts[0].attachments[0].body = Buffer.from(JSON.stringify(document)).toString(
      'base64',
    );
    assert.throws(() => verifyAttemptReports(input), new RegExp(`phase: ${phase}`));
  });
}

test('rejects delayed progress, unrelated sandboxes, and leaked fixture secrets', () => {
  const delayed = fixture().input;
  delayed.live.errors.push('Business step started before live readiness was reported');
  assert.throws(() => verifyAttemptReports(delayed), /Live reporting failed/);
  const unrelated = fixture().input;
  unrelated.records[0].value.sandboxId = 'someone-elses-run';
  assert.throws(() => verifyAttemptReports(unrelated), /no matching cleaned Sandbox/);
  const secret = fixture().input;
  secret.text += ' playwright-e2e-token';
  assert.throws(() => verifyAttemptReports(secret), /leaked/);
  const liveSecret = fixture().input;
  liveSecret.live.attempts[0].title = 'playwright-e2e-token';
  assert.throws(() => verifyAttemptReports(liveSecret), /leaked/);
});

test('requires complete, ordered and measured native lifecycle steps', () => {
  const missing = fixture().input;
  missing.live.attempts[0].lifecycleSteps.pop();
  assert.throws(() => verifyAttemptReports(missing), /duplicated or omitted/);
  const duplicate = fixture().input;
  duplicate.live.attempts[0].lifecycleSteps.push(
    structuredClone(duplicate.live.attempts[0].lifecycleSteps[0]),
  );
  assert.throws(() => verifyAttemptReports(duplicate), /duplicated or omitted/);
  const reordered = fixture().input;
  reordered.live.attempts[0].lifecycleSteps.reverse();
  assert.throws(() => verifyAttemptReports(reordered), /missing or out of order/);
  const failed = fixture().input;
  Object.assign(failed.live.attempts[0].lifecycleSteps[1], {
    status: 'failed',
    error: 'cleanup failed',
  });
  assert.throws(() => verifyAttemptReports(failed), /failed or did not complete/);
  const unmeasured = fixture().input;
  unmeasured.live.attempts[0].lifecycleSteps[0].duration = null;
  assert.throws(() => verifyAttemptReports(unmeasured), /invalid timings/);
  const outsideStart = fixture().input;
  outsideStart.live.attempts[0].acquisitionStartedAt = 50;
  assert.throws(() => verifyAttemptReports(outsideStart), /outside the native Start/);
  const fabricatedSequence = fixture().input;
  fabricatedSequence.live.attempts[0].lifecycleSteps[1].sequence = 7;
  assert.throws(() => verifyAttemptReports(fabricatedSequence), /missing or out of order/);
  const invalidStartTime = fixture().input;
  invalidStartTime.live.attempts[0].lifecycleSteps[0].startedAt = 'not-a-time';
  assert.throws(() => verifyAttemptReports(invalidStartTime), /invalid timings/);
});

test('rejects legacy lifecycle stdout while allowing consumer stdout', () => {
  const allowed = fixture().input;
  allowed.attempts[0].stdout.push({ text: 'application: sandbox ready for requests\n' });
  assert.equal(verifyAttemptReports(allowed).attempts.length, 1);
  for (const message of [
    'Blackbox: sandbox ready for system "subscription-system"',
    'Blackbox: sandbox cleaned up for system "subscription-system"',
    'Blackbox: sandbox cleanup failed for system "subscription-system"',
  ]) {
    const legacy = fixture().input;
    legacy.attempts[0].stdout.push({ text: `${message}\n` });
    assert.throws(() => verifyAttemptReports(legacy), /Legacy Blackbox lifecycle stdout/);
  }
  const rendered = fixture().input;
  rendered.text += '\nBlackbox: sandbox ready for system "subscription-system"';
  assert.throws(() => verifyAttemptReports(rendered), /Legacy Blackbox lifecycle stdout/);
});

test('rejects custom terminal rendering and missing diagnostics', () => {
  for (const extra of [
    'Blackbox · passed',
    '[1]   ✓ passed',
    'Docker health: starting',
    'waiting for Compose',
  ]) {
    const verbose = fixture().input;
    verbose.text += `\n${extra}`;
    assert.throws(() => verifyAttemptReports(verbose), /native output|internal polling/);
  }
  const diagnostics = fixture().input;
  diagnostics.attempts[0].attachments.pop();
  assert.throws(() => verifyAttemptReports(diagnostics), /Missing retained Blackbox diagnostics/);
});
