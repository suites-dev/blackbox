export const capsuleInspectorDetailScript = `
function inspectSpan(root, span, selection, presentation) {
  const aside = root.querySelector('.report-inspector');
  resetInspector(aside);
  const body = aside.querySelector('.inspector-body');
  body.replaceChildren();
  const close = n('button', 'inspect-close', 'Clear selection');
  close.type = 'button';
  close.onclick = () => resetInspector(aside);
  add(
    body,
    p('RAW TELEMETRY', 'eyebrow'),
    n('h3', '', presentation.title),
    p(presentation.direction, 'muted'),
    close,
  );
  const association = selection.kind === 'exact-activity'
    ? ['Activity correlation', 'Exact · ' + selection.activityId]
    : selection.kind === 'temporal-activity'
      ? ['Activity association', 'Temporal only · ' + selection.activityId]
      : ['Activity association', 'Session only · no exact activity'];
  const rows = [
    association,
    ['Original OTEL operation', span.operation],
    ['Span kind', span.spanKind],
    ['Trace ID', span.traceId],
    ['Span ID', span.spanId],
    ['Parent span ID', span.parentSpanId || 'Not retained'],
    ['Start · Unix ns', span.startTimeUnixNano || 'Unavailable'],
    ['End · Unix ns', span.endTimeUnixNano || 'Unavailable'],
    ['OTEL status code', span.statusCode === null ? 'Unavailable' : String(span.statusCode)],
  ];
  if (selection.kind !== 'exact-activity') rows.splice(1, 0, ['Session trace', selection.traceId]);
  const fields = n('dl', 'inspector-fields');
  for (const [key, value] of rows) add(fields, n('dt', '', key), n('dd', '', value));
  add(
    body,
    fields,
    n('h4', '', 'Retained attributes'),
    n('pre', '', JSON.stringify(span.attributes, null, 2)),
    n('h4', '', 'Trace links'),
    n('pre', '', JSON.stringify(span.links, null, 2)),
    p(
      'Bounded projection · other attributes are omitted. Missing fields are unavailable; these records do not establish completeness or application behavior.',
      'inspector-note',
    ),
  );
  aside.dataset.selected = 'true';
  body.setAttribute('tabindex', '-1');
  if (matchMedia('(max-width:1030px)').matches) aside.scrollIntoView({ block: 'start' });
  body.focus({ preventScroll: true });
}
`;
