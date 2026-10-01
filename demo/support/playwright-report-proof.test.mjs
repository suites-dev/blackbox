import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyAttemptReports } from './playwright-report-proof.mjs';

function fixture() {
  const document = {
    schemaVersion: 1,
    identity: {
      kind: 'acquired',
      sandboxId: 'run-a',
      executionId: 'run-a',
      sessionId: 'session-a',
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
          attachments: [
            {
              name: 'blackbox-attempt',
              body: Buffer.from(JSON.stringify(document)).toString('base64'),
            },
          ],
        },
      ],
      records: [{ value: { sandboxId: 'run-a', cleanup: 'complete' } }],
      live: { errors: [], attempts: [{}] },
      text: 'run-a Then And collector: shutdown complete; passed · 10ms total',
    },
  };
}

test('accepts matched live, retained and Docker cleanup evidence', () => {
  const { input } = fixture();
  assert.equal(verifyAttemptReports(input).attempts.length, 1);
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
