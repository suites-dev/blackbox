export const capsuleTelemetryRowsScript = `
function telemetrySpanRow(span, spans, selection, root, layout) {
  const presentation = spanPresentation(span, spans), button = n('button', 'span-row');
  button.type = 'button';
  button.style.setProperty('--span-depth', String(layout.depth.get(span.spanId) || 0));
  add(
    button,
    icon('branch'),
    add(
      n('span', 'span-summary'),
      n('strong', 'span-operation', presentation.title),
      n('small', 'span-direction', presentation.direction),
      n('small', 'span-timing', spanTimingText(span, layout.origin)),
    ),
    icon('chevron'),
  );
  button.addEventListener('click', () =>
    inspectSpan(root, span, selection, presentation),
  );
  return button;
}
function telemetryResourceRun(run, spans, selection, root, layout) {
  if (run.spans.length === 1) return telemetrySpanRow(run.spans[0], spans, selection, root, layout);
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
  for (const span of run.spans) add(rows, telemetrySpanRow(span, spans, selection, root, layout));
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
  const layout = spanLayout(retained.spans);
  const selection = { kind: 'exact-activity', activityId: a.activityId };
  for (const run of telemetryRuns(layout.spans)) {
    add(
      block,
      run.kind === 'resource-run'
        ? telemetryResourceRun(run, retained.spans, selection, root, layout)
        : telemetrySpanRow(run.span, retained.spans, selection, root, layout),
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
function sessionTraceTelemetry(trace, root, context) {
  const block = n('div', 'session-trace');
  const association = context.kind === 'activity-window'
    ? { kind: 'temporal-activity', activityId: context.activityId, traceId: trace.traceId }
    : { kind: 'session-only', traceId: trace.traceId };
  add(
    block,
    add(n('div', 'session-trace-head'),
      n('strong', '', 'Trace ' + trace.traceId),
      badge(context.kind === 'activity-window' ? 'temporal window' : 'session only', 'warn')),
  );
  if (trace.kind === 'unavailable') {
    add(block, p('Telemetry ' + trace.reason + '.', 'telemetry-empty'));
    return block;
  }
  const layout = spanLayout(trace.spans);
  for (const run of telemetryRuns(layout.spans)) {
    add(block, run.kind === 'resource-run'
      ? telemetryResourceRun(run, trace.spans, association, root, layout)
      : telemetrySpanRow(run.span, trace.spans, association, root, layout));
  }
  return block;
}
function activityWindowTelemetry(d, a, root) {
  if (d.observations.kind !== 'collector-session-found') return null;
  const traces = d.observations.traces.sessionOnly.filter(trace =>
    trace.association.kind === 'activity-window' &&
    trace.association.activityId === a.activityId);
  if (!traces.length) return null;
  const block = n('div', 'raw-telemetry temporal-observations');
  add(block, n('h4', '', 'Observed after this activity'),
    p('Same activity time window · temporal only · no causal relationship established.',
      'telemetry-caption'));
  for (const trace of [...traces].sort(compareTraceStarts))
    add(block, sessionTraceTelemetry(trace, root, trace.association));
  return block;
}
function isReadinessProbe(trace) {
  return trace.kind === 'available' && trace.spans.some((span) =>
    ['user_agent.original', 'http.user_agent'].some((key) =>
      spanAttribute(span, key).startsWith('blackbox-readiness/')));
}
function readinessProbes(probes, root) {
  const details = n('details', 'session-trace readiness-probes'), summary = n('summary');
  add(summary, n('strong', '', probes.length + ' readiness probe traces'),
    badge('Blackbox readiness probes', 'neutral'));
  add(details, summary,
    p('Requests Blackbox sent to the entrypoint while it waited for readiness, collapsed into one row.',
      'telemetry-caption'));
  for (const trace of probes) add(details, sessionTraceTelemetry(trace, root, trace.association));
  return details;
}
function sessionObservations(d, root) {
  const section = n('section', 'section');
  section.id = 'session-observations';
  add(section, title('UNCORRELATED TELEMETRY', 'Session observations',
    'Retained traces without exact activity correlation. Temporal placement is descriptive, not causal.'));
  const panel = n('div', 'panel session-observations');
  const traces = d.observations.kind === 'collector-session-found'
    ? d.observations.traces.sessionOnly : [];
  if (!traces.length) add(panel, p('No session-only traces were retained.', 'empty'));
  const probes = traces.filter(isReadinessProbe);
  if (probes.length) add(panel, readinessProbes([...probes].sort(compareTraceStarts), root));
  for (const trace of [...traces].filter((trace) => !isReadinessProbe(trace)).sort(compareTraceStarts))
    add(panel, sessionTraceTelemetry(trace, root, trace.association));
  add(section, panel);
  return section;
}
`;
