import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { BehaviorHistory, ingestPlaywrightResults } from '@suites/blackbox-playwright/history';

function attachment(result, name) {
  const matches = result.attachments.filter((item) => item.name === name);
  assert.equal(matches.length, 1, `expected one ${name} attachment`);
  assert.equal(typeof matches[0].body, 'string', `missing inline ${name} bytes`);
  const bytes = Buffer.from(matches[0].body, 'base64');
  return { value: JSON.parse(bytes.toString('utf8')),
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

function verifySuccess(events, result, execution) {
  assert.deepEqual(events.map(({ kind }) => kind), ['begin', 'precondition', 'action', 'final', 'claim', 'claim']);
  const [begin, precondition, action, final, claim, snapshot] = events;
  const expected = [{ id: 'subscription_alice', status: 'active' }];
  assert.equal(begin.initial.failureCount, 0);
  assert.deepEqual(begin.initial.observers, [{ name: 'subscriptions', readers: [{ name: 'rows', status: 'captured', value: [] }] }]);
  assert.equal(precondition.status, 'passed');
  assert.equal(action.status, 'completed');
  assert.equal(action.captured.output.kind, 'response');
  assert.equal(action.captured.output.status, 201);
  assert.deepEqual(action.captured.output.body.subscription, expected[0]);
  assert.equal(final.final.failureCount, 0);
  assert.deepEqual(final.final.observers, [{ name: 'subscriptions', readers: [{ name: 'rows', status: 'captured', value: expected }] }]);
  assert.equal(final.diff.initialCheckpointId, begin.initial.checkpointId);
  assert.equal(final.diff.finalCheckpointId, final.final.checkpointId);
  assert.deepEqual(final.diff.observers, [{ name: 'subscriptions', status: 'captured', diff: { rows: { added: expected, removed: [], changed: [] } } }]);
  assert.equal(claim.status, 'passed');
  assert.equal(snapshot.status, 'passed');
  assert.deepEqual(snapshot.snapshots, [{ matcher: 'toMatchSnapshot', status: 'passed' }]);
  const effects = attachment(result, 'effects.json');
  assert.equal(effects.value.kind, 'stimulus-effects');
  assert.equal(effects.value.executionId, begin.executionId);
  assert.equal(effects.value.identity.sessionId, execution.sessionId);
  assert.equal(effects.value.identity.executionId, execution.attemptExecutionId);
  assert.deepEqual(effects.value.identity.activityIds, [action.activityId]);
  assert.equal(action.captured.effects, effects.digest);
  // The cut is allowed to be open. Presence, order and completeness remain separate claims.
  assert(Array.isArray(effects.value.graph.effects));
  return effects.digest;
}

function verifyStopped(events, index) {
  assert.deepEqual(events.map(({ kind }) => kind), index === 1
    ? ['begin', 'precondition', 'action'] : ['begin', 'action']);
  assert.equal(events.at(-1).status, 'not-executed');
  if (index === 1) assert.equal(events[1].status, 'failed');
  else {
    assert.equal(events[0].initial.failureCount, 1);
    assert.deepEqual(events[0].initial.observers, [{ name: 'broken', readers: [{ name: 'value', status: 'failed' }] }]);
  }
}

export async function verifyDurableLifecycle(results, cases) {
  const history = await BehaviorHistory.open(join(results, 'history'));
  const ingestion = await ingestPlaywrightResults(history, join(results, 'results.json'));
  assert.equal(ingestion.attempts, 3);
  assert.equal(ingestion.envelopes, 3);
  assert.deepEqual(ingestion.rejected, []);
  const index = await history.index();
  assert.equal(index.executions.length, 3);
  assert.deepEqual(index.corrupt, []);
  const executions = [];
  for (const [position, spec] of cases.entries()) {
    const result = spec.tests[0].results[0];
    const envelope = attachment(result, 'blackbox-envelope').value;
    const execution = attachment(result, 'blackbox-execution');
    const row = index.executions.find(({ envelopeId }) => envelopeId === envelope.digest);
    assert(row, 'missing indexed execution');
    assert.equal(row.finalStatus, result.status);
    const detail = await history.execution(envelope.digest);
    assert(detail, 'missing retained execution');
    assert.equal(detail.envelope.digest, envelope.digest);
    assert(detail.evidence.some(({ id, status }) => id === execution.digest && status === 'stored'), 'execution bytes were not retained');
    assert.equal(execution.value.attemptExecutionId, envelope.identity.attempt.executionId);
    const events = execution.value.events;
    assert(events.every((event) => event.executionId === events[0].executionId), 'foreign stimulus events');
    if (position === 0) {
      const effectsId = verifySuccess(events, result, execution.value);
      assert(detail.evidence.some(({ id, status }) => id === effectsId && status === 'stored'), 'effects bytes were not retained');
    } else verifyStopped(events, position);
    executions.push({ title: spec.title, envelope: envelope.digest, execution: execution.digest, finalStatus: row.finalStatus });
  }
  assert.equal((await history.rebuildIndex()).digest, index.digest);
  const repeated = await ingestPlaywrightResults(history, join(results, 'results.json'));
  assert.equal(repeated.newEnvelopes, 0);
  assert.equal((await history.rebuildIndex()).digest, index.digest);
  return { executions, historyDigest: index.digest, rebuilt: true, duplicateIngestionStable: true };
}
