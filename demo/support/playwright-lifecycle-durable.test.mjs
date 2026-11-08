import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyLifecycleEffects, verifyStoredLifecycleEvidence, verifySubscriptionAcceptance } from './playwright-lifecycle-durable.mjs';

function encoded(name, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { attachment: { name, body: bytes.toString('base64') }, bytes: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}

function fixture(change = () => {}) {
  const effect = { id: 'payment', kind: 'http', actor: 'payment-mock', operation: 'POST',
    target: '/v1/payment_intents', outcome: 'success', attributes: { 'http.method': 'POST' },
    source: [{ traceId: 'trace', spanId: 'span' }] };
  const identity = { sessionId: 'session', executionId: 'attempt', scopeId: 'scope',
    captureId: 'terminal', activityIds: ['activity'] };
  const terminal = { kind: 'stimulus-effects', executionId: 'stimulus', identity,
    graph: { scope: { id: 'scope', closed: false }, effects: [effect] },
    evidence: { kind: 'admitted', selection: { scopeId: 'scope', sessionId: 'session', executionId: 'attempt',
      activities: [{ activityId: 'activity', purpose: 'stimulus', traceIds: ['trace'] }] },
      ownership: [{ effectId: 'payment', observations: [{ traceId: 'trace', spanId: 'span',
        owners: [{ activityId: 'activity', purpose: 'stimulus' }] }] }] } };
  const initial = structuredClone(terminal);
  initial.identity.captureId = 'initial';
  initial.graph.effects = [];
  initial.evidence.ownership = [];
  const { attributes, ...witness } = structuredClone(effect);
  const assertion = { assertion: { matcher: 'toHaveEmitted', negated: false, outcome: 'passed', evaluation: 'pass' },
    assessment: { identity: structuredClone(identity), status: 'pass', evidence: ['payment'], possibleEvidence: [] },
    witnesses: [{ ...witness, fields: Object.entries(attributes).map(([key, value]) => ({ key, value })),
      omittedSources: 0, omittedFields: 0 }] };
  change({ initial, terminal, assertion });
  const cuts = [encoded('effects.json', initial), encoded('effects.json', terminal)];
  const verdict = encoded('blackbox-emissions', { ...assertion, captureReference: cuts[1].digest });
  const artifacts = [...cuts, verdict].map(({ digest, bytes }) => ({ digest, bytes }));
  const input = { begin: { executionId: 'stimulus' }, action: { activityId: 'activity', captured: { effects: cuts[0].digest } },
    claim: { evidence: [cuts[1].digest, verdict.digest] }, snapshot: { evidence: [] },
    result: { attachments: [...cuts, verdict].map(({ attachment }) => attachment) },
    execution: { sessionId: 'session', attemptExecutionId: 'attempt' } };
  const retained = { envelope: { evidence: artifacts.map(({ digest, bytes }) => ({ id: digest, bytes })) },
    evidence: artifacts.map(({ digest }) => ({ id: digest, status: 'stored' })) };
  return { input, artifacts, retained };
}

test('accepts distinct initial and terminal cuts with exact assertion, claim and retained byte references', () => {
  const { input, artifacts, retained } = fixture();
  const checked = verifyLifecycleEffects(input);
  assert.deepEqual(checked.map(({ digest, bytes }) => ({ digest, bytes })), artifacts);
  verifyStoredLifecycleEvidence(retained, checked);
});

test('rejects substituted cuts, duplicate cuts and changes to exact attachment bytes', () => {
  for (const change of [
    (input) => { input.action.captured.effects = input.claim.evidence[0]; },
    (input) => { input.result.attachments.push(input.result.attachments[1]); },
    (input) => { input.claim.evidence[1] = `sha256:${'0'.repeat(64)}`; },
    (input) => { input.result.attachments[1].body = Buffer.from(Buffer.from(input.result.attachments[1].body, 'base64').toString() + '\n').toString('base64'); },
    (input) => { input.result.attachments[2].body = Buffer.from(Buffer.from(input.result.attachments[2].body, 'base64').toString() + '\n').toString('base64'); },
  ]) {
    const { input } = fixture();
    change(input);
    assert.throws(() => verifyLifecycleEffects(input));
  }
});

test('rejects foreign capture identities, witness contents, observation sources and activity owners', () => {
  for (const change of [
    ({ terminal }) => { terminal.identity.sessionId = 'foreign-session'; },
    ({ terminal }) => { terminal.identity.activityIds = ['foreign-activity']; },
    ({ assertion }) => { assertion.assessment.identity.captureId = 'other-cut'; },
    ({ assertion }) => { assertion.witnesses[0].target = '/another-payment'; },
    ({ assertion }) => { assertion.witnesses[0].source[0].spanId = 'another-span'; },
    ({ terminal }) => { terminal.evidence.ownership[0].observations[0].owners[0].activityId = 'foreign-activity'; },
    ({ terminal }) => { terminal.evidence.selection.activities[0].traceIds = ['foreign-trace']; },
    ({ assertion }) => { assertion.assessment.evidence = []; assertion.witnesses = []; },
  ]) {
    const { input } = fixture(change);
    assert.throws(() => verifyLifecycleEffects(input));
  }
});

test('rejects missing terminal/assertion claim links and cross-claim attribution', () => {
  for (const change of [
    (input) => { input.claim.evidence.shift(); },
    (input) => { input.claim.evidence.pop(); },
    (input) => { input.snapshot.evidence = input.claim.evidence; },
    (input) => { input.claim.evidence.unshift(input.action.captured.effects); },
  ]) {
    const { input } = fixture();
    change(input);
    assert.throws(() => verifyLifecycleEffects(input));
  }
});

test('requires unique stored hash-verified bytes with the exact attachment byte count', () => {
  for (const change of [
    (retained) => { retained.evidence[1].status = 'missing'; },
    (retained) => { retained.evidence[1].status = 'verified'; },
    (retained) => { retained.envelope.evidence[1].bytes++; },
    (retained) => { retained.envelope.evidence.splice(1, 1); },
    (retained) => { retained.evidence.push(retained.evidence[1]); },
  ]) {
    const { artifacts, retained } = fixture();
    change(retained);
    assert.throws(() => verifyStoredLifecycleEvidence(retained, artifacts));
  }
});

function acceptanceFixture(change = () => {}) {
  const { input } = fixture(change);
  const subscription = { id: 'subscription_alice', status: 'active' };
  const checkpoint = (checkpointId, value) => ({ checkpointId, failureCount: 0,
    observers: [{ name: 'subscriptions', readers: [{ name: 'rows', status: 'captured', value }] }] });
  const initial = JSON.parse(Buffer.from(input.result.attachments[0].body, 'base64').toString('utf8'));
  const captured = { output: { kind: 'response', status: 201, body: { userId: 'alice', subscription } },
    effects: input.action.captured.effects,
    effectCaptures: [{ captureId: initial.identity.captureId, reference: input.action.captured.effects, purpose: 'initial' }] };
  const events = [
    { kind: 'begin', executionId: 'stimulus', title: 'When Alice subscribes with her payment method', initial: checkpoint('initial-state', []) },
    { kind: 'precondition', title: 'Given no subscriptions exist', status: 'passed' },
    { kind: 'action', activityId: 'activity', status: 'completed', captured },
    { kind: 'final', final: checkpoint('final-state', [subscription]),
      diff: { initialCheckpointId: 'initial-state', finalCheckpointId: 'final-state',
        observers: [{ name: 'subscriptions', status: 'captured', diff: { rows: { added: [subscription], removed: [], changed: [] } } }] } },
    { kind: 'claim', title: 'Then an active subscription is returned', status: 'passed', evidence: [], snapshots: [] },
    { kind: 'claim', title: 'And exactly that subscription is retained', status: 'passed', evidence: [], snapshots: [] },
    { kind: 'claim', title: 'And retained state matches the reviewed baseline', status: 'passed', evidence: [], snapshots: [{ matcher: 'toMatchSnapshot', status: 'passed' }] },
  ];
  return structuredClone({ events, result: { attachments: [input.result.attachments[0]] },
    execution: { ...input.execution, artifacts: [{ executionId: 'stimulus', ...captured }] } });
}

test('accepts the clean subscription contract with one recorded initial cut and three named claims', () => {
  const { events, result, execution } = acceptanceFixture();
  const [cut] = verifySubscriptionAcceptance(events, result, execution);
  assert.equal(cut.digest, events[2].captured.effects);
  assert.equal(cut.bytes, Buffer.from(result.attachments[0].body, 'base64').length);
});

test('rejects captured response and PostgreSQL checkpoint or diff disagreement', () => {
  for (const change of [
    (events) => { events[0].initial.observers[0].readers[0].value = [{ id: 'prior', status: 'active' }]; },
    (events) => { events[2].captured.output.status = 200; },
    (events) => { events[2].captured.output.body.subscription = { id: 42, status: 'active' }; },
    (events) => { events[2].captured.output.body.subscription = { id: 'subscription_alice', status: 'inactive' }; },
    (events) => { events[3].final.observers[0].readers[0].value = [{ id: 'other', status: 'active' }]; },
    (events) => { events[3].diff.observers[0].diff.rows.added = []; },
    (events) => { events[3].diff.initialCheckpointId = 'another-checkpoint'; },
  ]) {
    const { events, result, execution } = acceptanceFixture();
    change(events);
    assert.throws(() => verifySubscriptionAcceptance(events, result, execution));
  }
});

test('requires all three named passed claims, the native snapshot and no effect assertion', () => {
  for (const change of [
    ({ events }) => { events.pop(); },
    ({ events }) => { events[4].title = 'Another claim'; },
    ({ events }) => { events[5].status = 'inconclusive'; },
    ({ events }) => { events[5].evidence = ['unexpected-effect-assertion']; },
    ({ events }) => { events[6].snapshots = []; },
    ({ result }) => { result.attachments.push(encoded('blackbox-emissions', { assertion: { outcome: 'passed' } }).attachment); },
    ({ result }) => { result.attachments.push(encoded('blackbox-effects', { outcome: 'passed' }).attachment); },
    ({ result }) => { result.attachments.push(result.attachments[0]); },
  ]) {
    const input = acceptanceFixture();
    change(input);
    assert.throws(() => verifySubscriptionAcceptance(input.events, input.result, input.execution));
  }
});

test('requires the recorded initial cut to belong to this stimulus with exact artifact links', () => {
  for (const change of [
    ({ initial }) => { initial.identity.executionId = 'foreign-attempt'; },
    ({ initial }) => { initial.identity.activityIds = ['foreign-activity']; },
  ]) {
    const { events, result, execution } = acceptanceFixture(change);
    assert.throws(() => verifySubscriptionAcceptance(events, result, execution));
  }
  for (const change of [
    ({ events }) => { events[2].captured.effects = `sha256:${'0'.repeat(64)}`; },
    ({ events }) => { events[2].captured.effectCaptures[0].purpose = 'assertion'; },
    ({ execution }) => { execution.artifacts[0].executionId = 'foreign-stimulus'; },
    ({ result }) => { result.attachments = []; },
  ]) {
    const input = acceptanceFixture();
    change(input);
    assert.throws(() => verifySubscriptionAcceptance(input.events, input.result, input.execution));
  }
});
