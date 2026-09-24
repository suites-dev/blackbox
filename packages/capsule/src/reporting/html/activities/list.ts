export const capsuleActivityListScript = `
function activityBadge(a) {
  if (a.kind === 'running') return badge('running', 'warn');
  if (a.kind === 'failed') return badge('failed', 'bad');
  if (a.outcome.kind === 'client-completed')
    return a.outcome.telemetry.kind === 'incomplete'
      ? badge('telemetry incomplete', 'warn')
      : badge('client complete', 'good');
  return a.outcome.kind === 'signaled'
    ? badge('signal ' + a.outcome.signal, 'bad')
    : badge('exit ' + a.outcome.exitCode, a.outcome.exitCode === 0 ? 'good' : 'bad');
}
function activities(d, open, root) {
  const section = n('section', 'section');
  section.id = 'activities';
  add(
    section,
    title(
      'RECORDED INVOCATIONS',
      'Activity timeline',
      'Recorded invocations, process outcomes, and raw telemetry.',
    ),
  );
  const panel = n('div', 'activity-list');
  if (!d.activities.length) add(panel, p('No activities were recorded for this session.', 'empty'));
  for (const item of d.activities) add(panel, activityRow(item, open, d, root));
  add(section, panel);
  return section;
}
`;
