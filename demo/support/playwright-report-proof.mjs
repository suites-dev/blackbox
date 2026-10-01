import { join } from 'node:path';

function assert(value, message) {
  if (!value) throw new Error(message);
}

export function verifyAttemptReports({ attempts, records, live, text }) {
  assert(live.errors.length === 0, `Live reporting failed: ${live.errors.join('; ')}`);
  assert(live.attempts.length === attempts.length, 'Live report omitted attempts');
  const identities = [];
  for (const attempt of attempts) {
    const attachment = attempt.attachments.find(({ name }) => name === 'blackbox-attempt');
    assert(typeof attachment?.body === 'string', 'Missing Blackbox attempt attachment');
    const document = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    assert(
      document.schemaVersion === 1 && document.identity?.kind === 'acquired',
      'Missing acquired identity',
    );
    const { sandboxId, executionId, sessionId, catalogEntry } = document.identity;
    const owner = document.owner;
    assert(
      owner !== undefined &&
        ['testId', 'retry', 'workerIndex', 'parallelIndex'].every(
          (key) => owner[key] !== undefined && owner[key] === attempt[key],
        ),
      'Report belongs to a different Playwright attempt',
    );
    const liveAttempts = live.attempts.filter(
      (item) => item.testId === attempt.testId && item.retry === attempt.retry,
    );
    assert(
      liveAttempts.length === 1 &&
        liveAttempts[0].workerIndex === attempt.workerIndex &&
        liveAttempts[0].parallelIndex === attempt.parallelIndex &&
        liveAttempts[0].sandboxId === sandboxId,
      'Live report belongs to a different Playwright attempt or sandbox',
    );
    assert(
      sandboxId === executionId && typeof sessionId === 'string',
      'Invalid report execution identity',
    );
    const record = records.find(({ value }) => value.sandboxId === sandboxId);
    assert(
      record !== undefined && record.value.cleanup === 'complete',
      'Report has no matching cleaned Sandbox',
    );
    assert(
      catalogEntry.id === attempt.expectedCatalog.id &&
        catalogEntry.kind === attempt.expectedCatalog.kind,
      'Report catalog does not match its scenario',
    );
    assert(
      typeof owner.outputDirectory === 'string' &&
        record.recordDirectory === join(owner.outputDirectory, 'blackbox'),
      'Sandbox record is outside its owning attempt output directory',
    );
    const events = document.events;
    const completed = (phase) =>
      events.findIndex((event) => event.phase === phase && event.status === 'completed');
    const phases = [
      'catalog',
      'acquisition',
      'instrumentation',
      'readiness',
      'sandbox',
      'teardown',
      'collector',
    ];
    let previous = -1;
    for (const phase of phases) {
      const current = completed(phase);
      assert(current > previous, `Missing or out-of-order phase: ${phase}`);
      previous = current;
    }
    assert(
      !events.some((event) => event.status === 'failed'),
      'Passed attempt has failed report phase',
    );
    assert(
      events.some(
        (event) => event.phase === 'observations' && /[1-9]\d* spans/u.test(event.detail),
      ),
      'Report has no received telemetry',
    );
    assert(text.includes(sandboxId), 'Text report omitted sandbox identity');
    identities.push({ sandboxId, sessionId, catalogEntry });
  }
  assert(
    new Set(identities.map(({ sandboxId }) => sandboxId)).size === attempts.length,
    'Report reused a Sandbox',
  );
  assert(text.includes('Then') && text.includes('And'), 'Text report omitted business steps');
  assert(!text.includes('artifacts: ../'), 'Artifact paths are not readable from the project');
  assert(
    (text.match(/passed · \d+ms total/gu) ?? []).length === attempts.length,
    'Text report omitted total attempt durations',
  );
  assert(text.includes('collector: shutdown complete'), 'Text report omitted collector shutdown');
  assert(!text.includes('playwright-e2e-token'), 'Text report leaked the fixture token');
  return { kind: 'playwright-reporting-proof', attempts: identities, live: true };
}
