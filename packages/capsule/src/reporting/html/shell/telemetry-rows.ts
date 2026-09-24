export const capsuleTelemetryRowsScript = `
function rawTelemetry(d, a, root) {
  const block = n('div', 'raw-telemetry');
  add(block, n('h4', '', 'Raw telemetry'), p('What was observed', 'muted'));
  const retained = d.activityTelemetry.find((item) => item.activityId === a.activityId);
  if (!retained || retained.kind === 'unavailable') {
    add(
      block,
      p(
        retained && retained.reason === 'corrupt'
          ? 'Unavailable · retained telemetry could not be read.'
          : 'Unavailable · raw telemetry was not retained for this exact activity ID.',
        'telemetry-empty',
      ),
    );
    return block;
  }
  for (const span of retained.spans) {
    const button = n('button', 'span-row');
    button.type = 'button';
    add(
      button,
      icon('branch'),
      n('span', 'span-operation', span.operation),
      n('span', 'span-service', span.service),
      icon('chevron'),
    );
    button.addEventListener('click', () => inspectSpan(root, span, a.activityId));
    add(block, button);
  }
  add(
    block,
    p(
      'Select a span to inspect IDs, timing, status, attributes, and trace links.',
      'telemetry-caption',
    ),
  );
  return block;
}
`;
