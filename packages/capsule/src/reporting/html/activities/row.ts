export const capsuleActivityRowScript = `
function activityRow(a, open, d, root) {
  const details = n('details', 'activity');
  details.id = 'activity-' + a.sequence;
  details.open = open.includes(details.id);
  const summary = n('summary'),
    target =
      a.target.kind === 'host'
        ? 'Host'
        : a.target.kind === 'client'
          ? 'Client · ' + a.target.clientId
          : 'Participant · ' + a.target.participant,
    command = a.argv.map((value) => JSON.stringify(value)).join(' ');
  add(
    summary,
    n('span', 'sequence', String(a.sequence).padStart(2, '0')),
    add(
      n('span', 'activity-title'),
      n('small', 'activity-role', target),
      n('strong', '', command || '(empty command)'),
      n('small', '', date(a.startedAt)),
    ),
    activityBadge(a),
  );
  const body = n('div', 'activity-body');
  add(
    body,
    p(
      a.kind === 'running'
        ? date(a.startedAt) + ' → incomplete'
        : date(a.startedAt) + ' → ' + date(a.completedAt),
      'muted',
    ),
  );
  add(body, n('h4', '', 'Command'), n('pre', '', command));
  if (a.kind === 'failed')
    add(body, n('h4', '', 'Failure'), n('pre', '', a.error.name + ': ' + a.error.message));
  if (a.kind === 'completed' && a.outcome.kind === 'client-completed')
    add(
      body,
      n('h4', '', 'Client result'),
      n('pre', '', JSON.stringify(a.outcome.result, null, 2)),
    );
  if (a.kind === 'completed' && a.outcome.kind !== 'client-completed')
    for (const [label, value] of [
      ['Standard output', a.outcome.stdout || '(no standard output)'],
      ['Standard error', a.outcome.stderr || '(no standard error)'],
    ])
      add(body, n('h4', '', label), n('pre', '', value));
  add(body, rawTelemetry(d, a, root));
  add(summary, icon('chevron'));
  add(details, summary, body);
  return details;
}
`;
