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
function activityTelemetry(d, a) {
  return d.activityTelemetry.find((item) => item.activityId === a.activityId);
}
function telemetryBadge(d, a) {
  const telemetry = activityTelemetry(d, a);
  if (telemetry && telemetry.kind === 'available')
    return badge(telemetry.spans.length + ' spans', 'good');
  if (telemetry && telemetry.reason === 'corrupt') return badge('telemetry unreadable', 'bad');
  return null;
}
function defaultOpenActivity(d, open) {
  if (open.length) return open;
  const telemetry = d.activityTelemetry.find((item) => item.kind === 'available');
  if (!telemetry) return open;
  const activity = d.activities.find((item) => item.activityId === telemetry.activityId);
  return activity ? ['activity-' + activity.sequence] : open;
}
function activities(d, open, root) {
  const section = n('section', 'section');
  section.id = 'activities';
  add(
    section,
    title(
      'RECORDED INVOCATIONS',
      'Activity timeline',
      'Recorded invocations and outcomes. Traced client activities include raw telemetry.',
    ),
  );
  const panel = n('div', 'activity-list');
  if (!d.activities.length) add(panel, p('No activities were recorded for this session.', 'empty'));
  const expanded = defaultOpenActivity(d, open);
  for (const item of d.activities) add(panel, activityRow(item, expanded, d, root));
  add(section, panel);
  return section;
}
`;
