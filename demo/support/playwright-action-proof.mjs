function assert(value, message) {
  if (!value) throw new Error(message);
}

const actionCounts = new Map([
  ['Scenario: a valid payment method creates a payment intent', 1],
  ['Scenario: a second refund for the same payment is rejected', 3],
  ['Scenario: an unknown payment intent cannot be refunded', 1],
  ['Scenario: an eligible user receives an active subscription', 1],
  ['Scenario: an unknown user is rejected without side effects', 1],
  ['Scenario: a local-only user activates without payment or ordering', 1],
  ['Scenario: a repeated request does not repeat downstream effects', 2],
  ['Scenario: concurrent requests create exactly one subscription', 2],
]);

function attachment(attempt, name) {
  const item = attempt.attachments.find((item) => item.name === name);
  assert(typeof item?.body === 'string', `Missing ${name} action evidence`);
  return JSON.parse(Buffer.from(item.body, 'base64').toString('utf8'));
}

/** Require an admitted HTTP witness for every independent action, not a raw span count. */
export function verifyActionWitnesses({ report, identity, expectedActions, actor }) {
  const evidence = report.evidence;
  assert(
    report.assertion.evaluation === 'satisfied' &&
      report.assertion.outcome === 'passed' &&
      report.assertion.negated === false &&
      evidence.kind === 'admitted',
    'Native action effects assertion was not satisfied with admitted evidence',
  );
  const selection = evidence.selection;
  assert(
    selection.sessionId === identity.sessionId &&
      selection.executionId === identity.executionId &&
      selection.kind === 'stimulus',
    'Native action evidence belongs to a different attempt or purpose',
  );
  for (const field of [
    'activities',
    'activityTraces',
    'effects',
    'effectSources',
    'ownership',
    'owners',
  ]) {
    assert(evidence.omitted[field] === 0, `Native action evidence omitted ${field}`);
  }
  assert(selection.activities.length === expectedActions, 'Native action selection count changed');
  const traces = [];
  const activities = new Set();
  for (const activity of selection.activities) {
    assert(
      activity.purpose === 'stimulus' && !activities.has(activity.activityId),
      'Invalid native action ownership',
    );
    activities.add(activity.activityId);
    assert(activity.traceIds.length === 1, 'Native action must have one independently owned trace');
    const traceId = activity.traceIds[0];
    assert(
      /^[\da-f]{32}$/u.test(traceId) && !/^0+$/u.test(traceId) && !traces.includes(traceId),
      'Native actions reused or omitted a trace',
    );
    const witnessed = evidence.projection.effects.some(
      (effect) =>
        effect.kind === 'http' &&
        effect.actor === actor &&
        effect.operation === 'POST' &&
        effect.source.some(
          (source) =>
            source.traceId === traceId &&
            evidence.ownership.some(
              (owned) =>
                owned.effectId === effect.id &&
                owned.observations.some(
                  (observation) =>
                    observation.traceId === source.traceId &&
                    observation.spanId === source.spanId &&
                    observation.owners.length === 1 &&
                    observation.owners[0].activityId === activity.activityId &&
                    observation.owners[0].purpose === 'stimulus',
                ),
            ),
        ),
    );
    assert(
      witnessed,
      `Native action ${activity.activityId} has no admitted ${actor} POST witness`,
    );
    traces.push(traceId);
  }
  return traces;
}

export function verifyNativeActionReports(attempts) {
  const seen = new Set();
  return attempts.map((attempt) => {
    const expectedActions = actionCounts.get(attempt.title);
    assert(expectedActions !== undefined, `Unknown native action scenario: ${attempt.title}`);
    const document = attachment(attempt, 'blackbox-attempt');
    const traces = verifyActionWitnesses({
      report: attachment(attempt, 'blackbox-effects'),
      identity: document.identity,
      expectedActions,
      actor: attempt.expectedCatalog.id === 'payment-mock' ? 'payment-mock' : 'public-api',
    });
    for (const trace of traces) {
      assert(!seen.has(trace), 'Native actions reused a trace across attempts');
      seen.add(trace);
    }
    return { title: attempt.title, witnessedActions: traces.length };
  });
}
