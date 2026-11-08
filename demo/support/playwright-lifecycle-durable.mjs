import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

function attachments(result, name) {
  return result.attachments.filter((item) => item.name === name).map((item) => {
    assert.equal(typeof item.body, 'string', `missing inline ${name} bytes`);
    const bytes = Buffer.from(item.body, 'base64');
    return { value: JSON.parse(bytes.toString('utf8')), bytes: bytes.length,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  });
}

function attachment(result, name) {
  const matches = attachments(result, name);
  assert.equal(matches.length, 1, `expected one ${name} attachment`);
  return matches[0];
}

function cutWithDigest(cuts, digest) {
  const matches = cuts.filter((cut) => cut.digest === digest);
  assert.equal(matches.length, 1, 'missing unique effects cut with referenced digest');
  return matches[0];
}

function verifyCut(cut, owner) {
  const { value } = cut;
  assert.equal(value.kind, 'stimulus-effects');
  assert.equal(value.executionId, owner.stimulus);
  assert.equal(value.identity.sessionId, owner.session);
  assert.equal(value.identity.executionId, owner.attempt);
  assert.deepEqual(value.identity.activityIds, [owner.activity]);
  assert.equal(typeof value.identity.captureId, 'string');
  assert(value.identity.captureId.length > 0);
  assert.equal(value.graph.scope.id, value.identity.scopeId);
  assert.equal(value.evidence.kind, 'admitted');
  assert.equal(value.evidence.selection.scopeId, value.identity.scopeId);
  assert.equal(value.evidence.selection.sessionId, owner.session);
  assert.equal(value.evidence.selection.executionId, owner.attempt);
  assert.deepEqual(value.evidence.selection.activities.map(({ activityId, purpose }) => ({ activityId, purpose })),
    [{ activityId: owner.activity, purpose: 'stimulus' }]);
  // An admitted cut can remain open; this proof establishes presence, not completeness.
  assert(Array.isArray(value.graph.effects));
}

function verifyWitnesses(assertion, cut, activityId) {
  const { assessment, witnesses } = assertion;
  assert(assessment.evidence.length > 0, 'passing assertion has no definite evidence');
  const ids = [...new Set([...assessment.evidence, ...assessment.possibleEvidence])].sort();
  assert.deepEqual(witnesses.map(({ id }) => id).sort(), ids);
  for (const witness of witnesses) {
    const effects = cut.graph.effects.filter(({ id }) => id === witness.id);
    assert.equal(effects.length, 1, 'witness is not in the terminal cut');
    const { attributes, ...effect } = effects[0];
    const { fields, omittedSources, omittedFields, ...reported } = witness;
    assert.equal(omittedSources, 0);
    assert.equal(omittedFields, 0);
    assert.deepEqual(reported, effect);
    assert.deepEqual(fields, Object.entries(attributes).map(([key, value]) => ({ key, value })));
    if (assessment.evidence.includes(witness.id)) {
      assert.equal(witness.kind, 'http');
      assert.equal(witness.actor, 'payment-mock');
      assert.equal(witness.operation, 'POST');
    }
    assert(witness.source.length > 0, 'witness has no observation source');
    const ownership = cut.evidence.ownership.filter(({ effectId }) => effectId === witness.id);
    assert.equal(ownership.length, 1, 'missing witness ownership');
    for (const source of witness.source) {
      const observations = ownership[0].observations.filter(({ traceId, spanId }) => traceId === source.traceId && spanId === source.spanId);
      assert.equal(observations.length, 1, 'witness source lacks ownership evidence');
      assert.deepEqual(observations[0].owners, [{ activityId, purpose: 'stimulus' }]);
      assert(cut.evidence.selection.activities[0].traceIds.includes(source.traceId), 'witness belongs to another trace');
    }
  }
}

export function verifyLifecycleEffects({ begin, action, claim, snapshot, result, execution }) {
  const cuts = attachments(result, 'effects.json');
  assert.equal(cuts.length, 2, 'expected the initial and terminal assertion cuts');
  const initial = cutWithDigest(cuts, action.captured.effects);
  const assertion = attachment(result, 'blackbox-emissions');
  const terminal = cutWithDigest(cuts, assertion.value.captureReference);
  assert.notEqual(terminal.digest, initial.digest, 'assertion reused the initial cut');
  assert.notEqual(terminal.value.identity.captureId, initial.value.identity.captureId);
  const owner = { stimulus: begin.executionId, session: execution.sessionId,
    attempt: execution.attemptExecutionId, activity: action.activityId };
  verifyCut(initial, owner);
  verifyCut(terminal, owner);
  assert.equal(terminal.value.identity.scopeId, initial.value.identity.scopeId);
  assert.deepEqual(assertion.value.assessment.identity, terminal.value.identity);
  assert.equal(assertion.value.assertion.matcher, 'toHaveEmitted');
  assert.equal(assertion.value.assertion.negated, false);
  assert.equal(assertion.value.assertion.outcome, 'passed');
  assert.equal(assertion.value.assertion.evaluation, 'pass');
  assert.equal(assertion.value.assessment.status, 'pass');
  verifyWitnesses(assertion.value, terminal.value, action.activityId);
  assert.deepEqual(claim.evidence, [terminal.digest, assertion.digest]);
  assert.deepEqual(snapshot.evidence, [], 'effects evidence leaked into the snapshot claim');
  return [initial, terminal, assertion];
}

export function verifyStoredLifecycleEvidence(detail, artifacts) {
  for (const artifact of artifacts) {
    const references = detail.envelope.evidence.filter(({ id }) => id === artifact.digest);
    assert.equal(references.length, 1, 'missing unique envelope evidence reference');
    assert.equal(references[0].bytes, artifact.bytes, 'retained artifact byte count differs');
    const stored = detail.evidence.filter(({ id }) => id === artifact.digest);
    assert.equal(stored.length, 1, 'missing unique retained evidence');
    assert.equal(stored[0].status, 'stored', 'artifact bytes were not retained and hash-verified');
  }
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
  return verifyLifecycleEffects({ begin, action, claim, snapshot, result, execution });
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

export async function verifyDurableLifecycle(results, cases, { BehaviorHistory, ingestPlaywrightResults }) {
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
    verifyStoredLifecycleEvidence(detail, [execution]);
    assert.equal(execution.value.attemptExecutionId, envelope.identity.attempt.executionId);
    const events = execution.value.events;
    assert(events.every((event) => event.executionId === events[0].executionId), 'foreign stimulus events');
    if (position === 0) {
      const artifacts = verifySuccess(events, result, execution.value);
      verifyStoredLifecycleEvidence(detail, artifacts);
    } else verifyStopped(events, position);
    executions.push({ title: spec.title, envelope: envelope.digest, execution: execution.digest, finalStatus: row.finalStatus });
  }
  assert.equal((await history.rebuildIndex()).digest, index.digest);
  const repeated = await ingestPlaywrightResults(history, join(results, 'results.json'));
  assert.equal(repeated.newEnvelopes, 0);
  assert.equal((await history.rebuildIndex()).digest, index.digest);
  return { executions, historyDigest: index.digest, rebuilt: true, duplicateIngestionStable: true };
}
