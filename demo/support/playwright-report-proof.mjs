import { join } from 'node:path';

function assert(value, message) {
  if (!value) throw new Error(message);
}

export function verifyParallelAcquisition({ attempts }) {
  const overlaps = attempts.flatMap((first, index) =>
    attempts
      .slice(index + 1)
      .filter(
        (second) =>
          first.workerIndex !== second.workerIndex &&
          [first, second].every(
            (attempt) =>
              Number.isFinite(attempt.acquisitionStartedAt) &&
              Number.isFinite(attempt.acquisitionCompletedAt) &&
              attempt.acquisitionStartedAt < attempt.acquisitionCompletedAt,
          ) &&
          Math.max(first.acquisitionStartedAt, second.acquisitionStartedAt) <
            Math.min(first.acquisitionCompletedAt, second.acquisitionCompletedAt),
      )
      .map((second) => [first, second]),
  );
  assert(
    overlaps.some(([first, second]) => first.file === second.file),
    'No concurrent sandbox acquisition within a test file',
  );
  assert(
    overlaps.some(([first, second]) => first.file !== second.file),
    'No concurrent sandbox acquisition across test files',
  );
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
    const stdout = (attempt.stdout ?? []).map(({ text }) => text ?? '').join('');
    const label = `${catalogEntry.kind} ${JSON.stringify(catalogEntry.id)}`;
    const ready = `Blackbox: sandbox ready for ${label}`;
    const cleaned = `Blackbox: sandbox cleaned up for ${label}`;
    assert(
      stdout.split(ready).length === 2 &&
        stdout.split(cleaned).length === 2 &&
        stdout.indexOf(ready) < stdout.indexOf(cleaned),
      'Native per-test stdout omitted or duplicated sandbox lifecycle messages',
    );
    assert(
      attempt.attachments.some(({ name }) => name === 'blackbox-diagnostics'),
      'Missing retained Blackbox diagnostics',
    );
    identities.push({ sandboxId, sessionId, catalogEntry });
  }
  assert(
    new Set(identities.map(({ sandboxId }) => sandboxId)).size === attempts.length,
    'Report reused a Sandbox',
  );
  assert(text.includes('Then') && text.includes('And'), 'Text report omitted business steps');
  assert(/\b\d+ passed\b/u.test(text), 'Text report omitted native Playwright summary');
  assert(
    !text.includes('Blackbox ·') && !/^\[\d+\]\s+[·✓→]/mu.test(text),
    'Custom reporter replaced native output',
  );
  assert(
    !text.includes('waiting for Compose') && !text.includes('Docker health:'),
    'Text report streamed internal polling',
  );
  assert(!text.includes('playwright-e2e-token'), 'Text report leaked the fixture token');
  return { kind: 'playwright-reporting-proof', attempts: identities, live: true };
}
