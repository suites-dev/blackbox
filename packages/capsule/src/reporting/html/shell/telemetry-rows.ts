export const capsuleTelemetryRowsScript = `
function telemetrySpanRow(span, spans, activityId, root) {
  const presentation = spanPresentation(span, spans), button = n('button', 'span-row');
  button.type = 'button';
  add(
    button,
    icon('branch'),
    add(
      n('span', 'span-summary'),
      n('strong', 'span-operation', presentation.title),
      n('small', 'span-direction', presentation.direction),
    ),
    icon('chevron'),
  );
  button.addEventListener('click', () =>
    inspectSpan(root, span, activityId, presentation),
  );
  return button;
}
function telemetryResourceRun(run, spans, activityId, root) {
  if (run.spans.length === 1) return telemetrySpanRow(run.spans[0], spans, activityId, root);
  const details = n('details', 'telemetry-resource-group'), summary = n('summary'), rows = n('div');
  add(
    summary,
    icon('stack'),
    add(
      n('span', 'span-summary'),
      n('strong', 'span-operation', run.label),
      n('small', 'span-direction', run.direction),
    ),
    badge(run.spans.length + ' operations'),
    icon('chevron'),
  );
  for (const span of run.spans) add(rows, telemetrySpanRow(span, spans, activityId, root));
  add(details, summary, rows);
  return details;
}
function rawTelemetry(d, a, root) {
  const retained = activityTelemetry(d, a);
  if (!retained || (retained.kind === 'unavailable' && retained.reason === 'not-retained')) {
    return null;
  }
  const block = n('div', 'raw-telemetry');
  add(block, n('h4', '', 'Raw telemetry'), p('What was observed', 'muted'));
  if (retained.kind === 'unavailable') {
    add(
      block,
      p('Unavailable · retained telemetry could not be read.', 'telemetry-empty'),
    );
    return block;
  }
  for (const run of telemetryRuns(retained.spans)) {
    add(
      block,
      run.kind === 'resource-run'
        ? telemetryResourceRun(run, retained.spans, a.activityId, root)
        : telemetrySpanRow(run.span, retained.spans, a.activityId, root),
    );
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
