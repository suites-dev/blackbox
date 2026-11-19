import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const scenario = 'Scenario: Alice submits a valid payment method';
const responseTitle = 'Then a succeeded intent is returned';
const stateTitle = 'And exactly that payment is persisted';
const snapshotTitle = 'And retained state matches the reviewed baseline';

export function digest(bytes) {
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

export function omitPaymentWrite(source) {
  const statement =
    "await pool.query('INSERT INTO payment_intent (id, status) VALUES ($1, $2)', [intent.id, intent.status]);";
  assert.equal(
    source.split(statement).length,
    2,
    'fixture must contain exactly one persistence statement',
  );
  return source.replace(
    statement,
    '// Defect: the cache and response succeed while the durable write is missing.',
  );
}

function attachment(result, name) {
  const found = result.attachments.filter((item) => item.name === name);
  assert.equal(found.length, 1, 'expected one ' + name);
  const bytes = Buffer.from(found[0].body, 'base64');
  return { data: JSON.parse(bytes), digest: digest(bytes) };
}

function specifications(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specifications)];
}

function state(checkpoint, rows, cachedIntent) {
  assert.equal(checkpoint.failureCount, 0);
  assert.equal(checkpoint.observers.length, 1);
  const [observer] = checkpoint.observers;
  assert.equal(observer.name, 'payments');
  assert.deepEqual(observer.readers.map((reader) => reader.name).sort(), ['cachedIntent', 'rows']);
  for (const reader of observer.readers) {
    assert.equal(reader.status, 'captured');
    assert.deepEqual(reader.value, reader.name === 'rows' ? rows : cachedIntent);
  }
}

export function verifyPaymentReport(report, broken) {
  const expectedStatus = broken ? 'failed' : 'passed';
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.stats, {
    ...report.stats,
    expected: broken ? 0 : 1,
    unexpected: broken ? 1 : 0,
    skipped: 0,
    flaky: 0,
  });
  const specs = specifications(report);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].title, scenario);
  assert.equal(specs[0].tests.length, 1);
  const [test] = specs[0].tests;
  assert.equal(test.expectedStatus, 'passed');
  assert.equal(test.results.length, 1);
  const [result] = test.results;
  assert.equal(result.status, expectedStatus);
  const envelope = attachment(result, 'blackbox-envelope').data;
  const execution = attachment(result, 'blackbox-execution').data;
  const cut = attachment(result, 'effects.json');
  const { attemptId, executionId, sessionId } = envelope.identity.attempt;
  for (const id of [attemptId, executionId, sessionId])
    assert.ok(typeof id === 'string' && id.length > 0);
  assert.equal(execution.attemptExecutionId, executionId);
  assert.equal(execution.sessionId, sessionId);
  const [begin, precondition, action, final, ...claims] = execution.events;
  assert.deepEqual(
    [begin.kind, precondition.kind, action.kind, final.kind],
    ['begin', 'precondition', 'action', 'final'],
  );
  assert.ok(execution.events.every((event) => event.executionId === begin.executionId));
  state(begin.initial, [], null);
  assert.equal(precondition.status, 'passed');
  assert.equal(precondition.title, 'Given no payment intents exist');
  assert.equal(action.status, 'completed');
  assert.equal(action.captured.output.kind, 'response');
  assert.equal(action.captured.output.status, 201);
  const intent = action.captured.output.body;
  assert.match(intent.id, /^pi_[\da-f-]+$/u);
  assert.deepEqual(intent, { id: intent.id, status: 'succeeded' });
  const expected = broken ? [] : [intent];
  state(final.final, expected, intent.id);
  assert.equal(final.diff.initialCheckpointId, begin.initial.checkpointId);
  assert.equal(final.diff.finalCheckpointId, final.final.checkpointId);
  assert.equal(final.diff.observers.length, 1);
  assert.deepEqual(final.diff.observers[0].diff.rows, {
    added: expected,
    removed: [],
    changed: [],
  });
  assert.equal(action.captured.effects, cut.digest);
  assert.equal(cut.data.kind, 'stimulus-effects');
  assert.equal(cut.data.executionId, begin.executionId);
  assert.equal(cut.data.identity.executionId, executionId);
  assert.equal(cut.data.identity.sessionId, sessionId);
  assert.deepEqual(cut.data.identity.activityIds, [action.activityId]);
  assert.equal(cut.data.evidence.kind, 'admitted');
  assert.deepEqual(
    claims.map(({ kind, title, status }) => [kind, title, status]),
    [
      ['claim', responseTitle, 'passed'],
      ['claim', stateTitle, expectedStatus],
      ...(broken ? [] : [['claim', snapshotTitle, 'passed']]),
    ],
  );
  if (broken) {
    assert.match(claims[1].error, /toEqual/u);
    assert.ok(result.errors.some((error) => /toEqual/u.test(error.message)));
  } else {
    assert.deepEqual(result.errors, []);
    assert.deepEqual(claims[2].snapshots, [{ matcher: 'toMatchSnapshot', status: 'passed' }]);
  }
  return {
    scenario,
    sandboxId: attemptId,
    executionId,
    sessionId,
    status: result.status,
    httpStatus: action.captured.output.status,
    persistedRows: expected,
    effects: cut.digest,
    claims: claims.map(({ title, status }) => ({ title, status })),
  };
}
