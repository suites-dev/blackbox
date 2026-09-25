export const capsuleActivityListScript = `
function processOutcome(a) {
  if (a.kind !== 'completed') return null;
  return a.outcome.kind === 'driver-completed' ? a.outcome.process :
    ['exited', 'signaled', 'executable-not-found'].includes(a.outcome.kind) ? a.outcome : null;
}
function processBadge(outcome) {
  if (!outcome) return null;
  if (outcome.kind === 'executable-not-found') return badge('executable missing', 'bad');
  if (outcome.kind === 'signaled') return badge('signal ' + outcome.signal, 'bad');
  return badge('exit ' + outcome.exitCode, outcome.exitCode === 0 ? 'good' : 'bad');
}
function activityBadge(a) {
  if (a.kind === 'running') return badge('running', 'warn');
  if (a.kind === 'interrupted') return badge('interrupted', 'bad');
  if (a.kind === 'failed') return badge('failed', 'bad');
  if (a.outcome.kind === 'driver-prepare-failed') return badge('driver failed', 'bad');
  if (a.outcome.kind === 'driver-propagation-refused') return badge('propagation refused', 'bad');
  return processBadge(processOutcome(a));
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
      'Recorded commands, execution locations, propagation outcomes, and raw telemetry.',
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
