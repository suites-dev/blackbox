import { join } from 'node:path';

function assert(value, message) {
  if (!value) throw new Error(message);
}

function exactKeys(value, keys, label) {
  assert(value !== null && typeof value === 'object', `${label} is not an object`);
  assert(
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    `${label} exposed an unexpected schema`,
  );
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

function verifyNativeLifecycle(liveAttempt) {
  assert(
    Array.isArray(liveAttempt.lifecycleSteps),
    'Live report omitted native sandbox lifecycle steps',
  );
  assert(
    liveAttempt.lifecycleSteps.length === 2,
    'Live report duplicated or omitted native sandbox lifecycle steps',
  );
  const [start, cleanup] = liveAttempt.lifecycleSteps;
  assert(
    start.title === 'Start sandbox' && cleanup.title === 'Clean up sandbox',
    'Native sandbox lifecycle steps are missing or out of order',
  );
  for (const step of [start, cleanup]) {
    exactKeys(
      step,
      [
        'title',
        'sequence',
        'startedAt',
        'startedAtMonotonic',
        'completedAtMonotonic',
        'duration',
        'status',
        'error',
      ],
      'Native sandbox lifecycle step',
    );
    assert(
      Number.isInteger(step.sequence) &&
        Number.isFinite(step.startedAtMonotonic) &&
        Number.isFinite(step.completedAtMonotonic) &&
        Number.isFinite(step.duration) &&
        step.duration >= 0 &&
        step.completedAtMonotonic >= step.startedAtMonotonic &&
        Number.isFinite(Date.parse(step.startedAt)),
      'Native sandbox lifecycle step has invalid timings',
    );
    assert(
      step.status === 'completed' && step.error === null,
      'Native sandbox lifecycle step failed or did not complete',
    );
  }
  assert(
    start.sequence === 0 &&
      cleanup.sequence === 1 &&
      start.completedAtMonotonic <= cleanup.startedAtMonotonic,
    'Native sandbox lifecycle steps are missing or out of order',
  );
  assert(
    start.startedAtMonotonic <= liveAttempt.acquisitionStartedAt &&
      liveAttempt.acquisitionStartedAt < liveAttempt.acquisitionCompletedAt &&
      liveAttempt.acquisitionCompletedAt <= start.completedAtMonotonic,
    'Sandbox acquisition timings fall outside the native Start sandbox step',
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
    verifyNativeLifecycle(liveAttempts[0]);
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
    const observationEvents = events.filter(
      (event) => event.phase === 'observations' && event.status === 'info',
    );
    assert(observationEvents.length === 1, 'Report has an unexpected observations summary');
    assert(/[1-9]\d* spans/u.test(observationEvents[0].detail), 'Report has no received telemetry');
    const stdout = (attempt.stdout ?? [])
      .map(
        ({ text, buffer }) =>
          text ??
          (typeof buffer === 'string' ? Buffer.from(buffer, 'base64').toString('utf8') : ''),
      )
      .join('');
    assert(
      !/Blackbox: sandbox (?:ready|cleaned up|cleanup failed)\b/u.test(`${stdout}\n${text}`),
      'Legacy Blackbox lifecycle stdout was emitted',
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
  assert(
    !text.includes('playwright-e2e-token') &&
      !JSON.stringify(live).includes('playwright-e2e-token'),
    'Playwright reporting leaked the fixture token',
  );
  return { kind: 'playwright-reporting-proof', attempts: identities, live: true };
}
