import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyLifecycleEffects, verifyStoredLifecycleEvidence } from './playwright-lifecycle-durable.mjs';

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
