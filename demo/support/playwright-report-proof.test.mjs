import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyAttemptReports } from './playwright-report-proof.mjs';

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
          attachments: [
            {
              name: 'blackbox-attempt',
              body: Buffer.from(JSON.stringify(document)).toString('base64'),
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
      live: { errors: [], attempts: [{ ...owner, sandboxId: `run-${suffix}` }] },
      text: `run-${suffix} Then And collector: shutdown complete; passed · 10ms total`,
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
});
