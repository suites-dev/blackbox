import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyActionWitnesses, verifyNativeActionReports } from './playwright-action-proof.mjs';

function fixture() {
  const identity = { sessionId: 'session', executionId: 'attempt' };
  const activities = [1, 2].map((index) => ({
    activityId: `action-${index}`,
    purpose: 'stimulus',
    traceIds: [index.toString(16).padStart(32, '0')],
  }));
  const effects = activities.flatMap((activity, index) =>
    Array.from({ length: index === 0 ? 4 : 1 }, (_, span) => {
      const source = {
        traceId: activity.traceIds[0],
        spanId: (span + 1).toString(16).padStart(16, '0'),
      };
      return {
        id: `${source.traceId}:${source.spanId}`,
        kind: 'http',
        actor: 'public-api',
        operation: 'POST',
        source: [source],
      };
    }),
  );
  const report = {
    assertion: { evaluation: 'satisfied', outcome: 'passed', negated: false },
    evidence: {
      kind: 'admitted',
      selection: { ...identity, kind: 'stimulus', activities },
      projection: { effects },
      ownership: effects.map((effect) => ({
        effectId: effect.id,
        observations: effect.source.map((source) => ({
          ...source,
          owners: [
            {
              activityId: activities.find((activity) => activity.traceIds.includes(source.traceId))
                .activityId,
              purpose: 'stimulus',
            },
          ],
        })),
      })),
      omitted: {
        activities: 0,
        activityTraces: 0,
        effects: 0,
        effectSources: 0,
        ownership: 0,
        owners: 0,
      },
    },
  };
  return { report, identity, expectedActions: 2, actor: 'public-api' };
}

test('five HTTP spans across two owned actions prove two actions, not five', () => {
  const input = fixture();
  assert.equal(input.report.evidence.projection.effects.length, 5);
  assert.deepEqual(
    verifyActionWitnesses(input),
    input.report.evidence.selection.activities.flatMap((activity) => activity.traceIds),
  );
});

test('four outgoing/HTTP spans from the first action cannot replace a missing later witness', () => {
  const input = fixture();
  input.report.evidence.projection.effects.pop();
  assert.equal(input.report.evidence.projection.effects.length, 4);
  assert.throws(
    () => verifyActionWitnesses(input),
    /action-2 has no admitted public-api POST witness/u,
  );
});

test('an unowned later request cannot disappear from the expected action count', () => {
  const input = fixture();
  input.report.evidence.selection.activities.pop();
  assert.throws(() => verifyActionWitnesses(input), /selection count changed/u);
});

test('a later witness cannot borrow another action owner', () => {
  const input = fixture();
  input.report.evidence.ownership.at(-1).observations[0].owners[0].activityId = 'action-1';
  assert.throws(() => verifyActionWitnesses(input), /no admitted public-api POST witness/u);
});

test('inspection purpose cannot masquerade as an action', () => {
  const input = fixture();
  input.report.evidence.selection.activities[1].purpose = 'inspection';
  assert.throws(() => verifyActionWitnesses(input), /Invalid native action ownership/u);
});

test('independent actions cannot reuse one trace', () => {
  const input = fixture();
  input.report.evidence.selection.activities[1].traceIds =
    input.report.evidence.selection.activities[0].traceIds;
  assert.throws(() => verifyActionWitnesses(input), /reused or omitted a trace/u);
});

test('evidence must belong to this physical attempt', () => {
  const input = fixture();
  input.report.evidence.selection.executionId = 'foreign';
  assert.throws(() => verifyActionWitnesses(input), /different attempt/u);
});

test('omitted ownership cannot be treated as a complete action proof', () => {
  const input = fixture();
  input.report.evidence.omitted.ownership = 1;
  assert.throws(() => verifyActionWitnesses(input), /omitted ownership/u);
});

test('native scenario mapping checks missing attachments and cross-attempt trace reuse', () => {
  const input = fixture();
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
  const attempt = {
    title: 'Scenario: a repeated request does not repeat downstream effects',
    expectedCatalog: { id: 'subscription-system' },
    attachments: [
      { name: 'blackbox-attempt', body: encode({ identity: input.identity }) },
      { name: 'blackbox-effects', body: encode(input.report) },
    ],
  };
  assert.deepEqual(verifyNativeActionReports([attempt]), [
    { title: attempt.title, witnessedActions: 2 },
  ]);
  assert.throws(
    () => verifyNativeActionReports([{ ...attempt, attachments: [] }]),
    /Missing blackbox-attempt/u,
  );
  assert.throws(() => verifyNativeActionReports([attempt, attempt]), /across attempts/u);
});
