export const capsuleInspectorDetailScript = `
function spanStartText(span) {
  if (!span.startTimeUnixNano) return 'Unavailable';
  return new Date(Number(BigInt(span.startTimeUnixNano) / 1000000n)).toISOString();
}
function spanDurationText(span) {
  if (!span.startTimeUnixNano || !span.endTimeUnixNano) return 'Unavailable';
  const micros = Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1000n);
  return (micros / 1000).toFixed(micros < 10000 ? 3 : 1) + ' ms';
}
function spanStatusText(code) {
  // OTLP omits an UNSET status; a missing code is UNSET, not missing data.
  if (code === null || code === 0) return 'UNSET';
  return code === 1 ? 'OK (1)' : code === 2 ? 'ERROR (2)' : String(code);
}
function exceptionRows(span) {
  const exceptions = span.exceptions || [];
  if (!exceptions.length) return [];
  const list = n('dl', 'inspector-fields');
  for (const item of exceptions) add(list, n('dt', '', item.type || 'Exception'), n('dd', '', item.message || '(no message)'));
  return [n('h4', '', 'Exceptions'), list];
}
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
    ['Parent span ID', span.parentSpanId || 'None (root span)'],
    ['Start', spanStartText(span)],
    ['Duration', spanDurationText(span)],
    ['Start · Unix ns', span.startTimeUnixNano || 'Unavailable'],
    ['End · Unix ns', span.endTimeUnixNano || 'Unavailable'],
    ['OTEL status code', spanStatusText(span.statusCode)],
  ];
  if (span.statusMessage) rows.push(['OTEL status message', span.statusMessage]);
  if (selection.kind !== 'exact-activity') rows.splice(1, 0, ['Session trace', selection.traceId]);
  const fields = n('dl', 'inspector-fields');
  for (const [key, value] of rows) add(fields, n('dt', '', key), n('dd', '', value));
  add(
    body,
    fields,
    ...exceptionRows(span),
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
