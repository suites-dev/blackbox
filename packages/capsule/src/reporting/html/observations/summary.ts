export const capsuleObservationSummaryScript = `
function collectorRunTone(run) {
  return run.failure.kind === 'recorded' || run.receiver === 'failed' ||
    run.receiver === 'interrupted' || run.shutdown === 'timed-out' ||
    run.shutdown === 'interrupted' ? 'bad' : 'neutral';
}
function addCollectorRun(card, run, index) {
  const instrumentation = run.instrumentation.kind === 'activated'
    ? run.instrumentation.activations.length + ' activations'
    : 'instrumentation not activated';
  add(
    card,
    p('Capture run ' + (index + 1) + ' · receiver ' + run.receiver +
      ' · shutdown ' + run.shutdown),
    badge('capture ' + run.receiver, collectorRunTone(run)),
    badge(instrumentation, run.instrumentation.kind === 'activated' ? 'good' : 'warn'),
  );
  if (run.failure.kind === 'recorded') {
    add(card, p(run.failure.error.name + ': ' + run.failure.error.message, 'muted'));
  }
}
function correlatedSpanCounts(d) {
  let system = 0, blackbox = 0;
  for (const item of d ? d.activityTelemetry : []) {
    if (item.kind !== 'available') continue;
    for (const span of item.spans) {
      if (span.service === 'blackbox-capsule') blackbox += 1;
      else system += 1;
    }
  }
  return { system, blackbox };
}
function observationSummary(card, observations, d) {
  if (observations.kind === 'collector-session-corrupt') {
    add(card, badge('corrupt', 'bad'),
      p(observations.error.name + ': ' + observations.error.message));
    return;
  }
  if (observations.kind === 'collector-session-missing') {
    add(card, badge('not retained', 'warn'), p(observations.message));
    return;
  }
  const received = observations.telemetry.status === 'received';
  add(
    card,
    badge(received ? 'received' : 'not received', received ? 'good' : 'warn'),
    p(observations.telemetry.acceptedSpans + ' spans received'),
    p(observations.traces.activityCorrelated.length + ' activity traces: ' +
      correlatedSpanCounts(d).system + ' system spans, ' +
      correlatedSpanCounts(d).blackbox + ' Blackbox spans (its own activity spans)'),
    p(observations.traces.sessionOnly.length + ' session-only observed traces'),
  );
  if (observations.traces.sessionOnly.length > 0) {
    add(card, p('Session-only traces have no exact activity correlation. ' +
      'No causal relationship is claimed.', 'muted'));
  }
  for (const [index, run] of observations.runs.entries()) {
    addCollectorRun(card, run, index);
  }
}
`;
