export const capsuleActivityRowScript = `
function executionLocation(location) {
  return location.kind === 'host'
    ? 'host'
    : 'participant ' + location.participantId + ' · service ' + location.service;
}
function propagationExpectation(value) {
  if (value.kind === 'propagation-not-requested') return 'not requested';
  return value.kind === 'w3c-trace-context-propagation'
    ? 'W3C trace context through ' + value.carrier
    : 'shared state unsupported · ' + value.resource;
}
function propagationOutcome(value) {
  if (value.kind === 'context-injected') return 'injected · ' + value.carrier;
  if (value.kind === 'context-not-supported')
    return 'not supported across ' + value.boundary + ' · ' + value.resource;
  if (value.kind === 'context-injection-failed')
    return 'injection failed · ' + value.carrier + ' · ' + value.message;
  return 'not injected · ' + value.reason;
}
function addPropagation(body, propagation) {
  add(
    body,
    n('h4', '', 'Trace propagation'),
    p('Expected · ' + propagationExpectation(propagation.expectation)),
    p('Actual · ' + propagationOutcome(propagation.outcome), 'muted'),
  );
}
function retentionText(value, redactions) {
  const redacted = redactions === 0 ? '' :
    ' · rewritten by ' + redactions + (redactions === 1 ? ' redaction' : ' redactions');
  if (value.kind !== 'complete')
    return value.retainedBytes + ' of ' + value.originalBytes + ' bytes retained; ' +
      value.omittedBytes + ' bytes omitted from the middle' + redacted;
  return redactions === 0
    ? value.originalBytes + ' bytes retained completely'
    : value.originalBytes + ' original bytes retained' + redacted;
}
function streamRedactions(d, a, stream) {
  const outcome = 'activities[' + d.activities.indexOf(a) + '].outcome.';
  return d.redactions.entries.filter((entry) =>
    entry.location === outcome + stream || entry.location === outcome + 'process.' + stream).length;
}
function addProcess(body, outcome, redactions) {
  add(body, n('h4', '', 'Execution location'), p(executionLocation(outcome.location)));
  if (outcome.kind === 'executable-not-found') {
    add(body, n('h4', '', 'Executable unavailable'), n('pre', '', outcome.remediation));
    return;
  }
  if (outcome.kind === 'not-executable') {
    add(body, n('h4', '', 'Executable not runnable'), n('pre', '', outcome.remediation));
    return;
  }
  for (const [label, value, retention, count] of [
    ['Standard output', outcome.stdout || '(no standard output)', outcome.retention.stdout, redactions.stdout],
    ['Standard error', outcome.stderr || '(no standard error)', outcome.retention.stderr, redactions.stderr],
  ]) {
    add(body, n('h4', '', label), n('pre', '', value), p(retentionText(retention, count), 'muted'));
  }
}
function addDriver(body, outcome, redactions) {
  add(
    body,
    n('h4', '', 'Driver'),
    p(outcome.driver.id + ' · target ' + outcome.driver.target.participantId +
      ' · ' + outcome.driver.target.protocol + ':' + outcome.driver.target.containerPort),
    p('Execution · ' + executionLocation(outcome.driver.execution), 'muted'),
  );
  addPropagation(body, outcome.propagation);
  addProcess(body, outcome.process, redactions);
}
function addOutcome(body, outcome, redactions) {
  if (outcome.kind === 'driver-completed') return addDriver(body, outcome, redactions);
  if (outcome.kind === 'driver-prepare-failed') {
    addPropagation(body, outcome.propagation);
    add(body, n('h4', '', 'Driver preparation failed'),
      n('pre', '', outcome.error.name + ': ' + outcome.error.message));
    return;
  }
  if (outcome.kind === 'driver-propagation-refused') {
    add(
      body,
      n('h4', '', 'Driver propagation refused'),
    );
    addPropagation(body, outcome.propagation);
    return;
  }
  addPropagation(body, outcome.propagation);
  addProcess(body, outcome, redactions);
}
function addTelemetryScope(body, telemetry) {
  add(
    body,
    n('h4', '', 'Telemetry execution scope'),
    p('Trace ' + telemetry.context.traceId + ' · execution ' + telemetry.executionId),
  );
  if (telemetry.kind === 'telemetry-execution-scope-completed-v1') {
    const result = telemetry.result;
    if (result.kind === 'telemetry-scope-failed')
      add(body, p('Limitation · telemetry scope failed: ' + result.message, 'muted'));
    if (result.kind === 'telemetry-scope-interrupted')
      add(body, p('Limitation · telemetry scope interrupted: ' + result.reason, 'muted'));
  }
}
function activityRow(a, open, d, root) {
  const details = n('details', 'activity purpose-' + a.purpose);
  details.id = 'activity-' + a.sequence;
  details.dataset.activityId = a.activityId;
  details.open = open.includes(details.id);
  const summary = n('summary'),
    target = a.target.kind === 'host' ? 'Host' : 'Driver · ' + a.target.driverId,
    command = a.argv.map((value) => JSON.stringify(value)).join(' '),
    named = a.name && a.name.kind === 'provided',
    heading = named ? a.name.value : command || '(empty command)',
    supporting = named ? command || '(empty command)' : date(a.startedAt);
  add(
    summary,
    n('span', 'sequence', String(a.sequence).padStart(2, '0')),
    add(
      n('span', 'activity-title'),
      n('small', 'activity-role', target + ' · ' + date(a.startedAt)),
      n('strong', '', heading),
      n('small', '', supporting),
    ),
    add(n('span', 'activity-badges'), purposeBadge(a.purpose), durationBadge(a),
      activityBadge(a), ...telemetryBadges(d, a)),
  );
  const body = n('div', 'activity-body');
  add(
    body,
    p(
      a.kind === 'running'
        ? date(a.startedAt) + ' → still running · ' + duration(a.startedAt, null) + ' elapsed'
        : date(a.startedAt) + ' → ' + date(a.completedAt) + ' · ' +
          duration(a.startedAt, a.completedAt),
      'muted',
    ),
    n('h4', '', 'Command'),
    n('pre', '', command),
  );
  if (a.kind === 'failed' || a.kind === 'interrupted')
    add(body, n('h4', '', a.kind === 'interrupted' ? 'Interruption' : 'Failure'),
      n('pre', '', a.error.name + ': ' + a.error.message));
  if (a.kind === 'completed') addOutcome(body, a.outcome,
    { stdout: streamRedactions(d, a, 'stdout'), stderr: streamRedactions(d, a, 'stderr') });
  addTelemetryScope(body, a.telemetry);
  const telemetry = rawTelemetry(d, a, root);
  if (telemetry) add(body, telemetry);
  const windowTelemetry = activityWindowTelemetry(d, a, root);
  if (windowTelemetry) add(body, windowTelemetry);
  add(summary, icon('chevron'));
  add(details, summary, body);
  return details;
}
`;
