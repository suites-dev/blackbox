export const capsuleTelemetryRowsScript = `
function spanAttribute(span, key) {
  const attribute = span.attributes.find((item) => item.key === key);
  return attribute ? String(attribute.value) : '';
}
function spanTitle(span) {
  const method =
    spanAttribute(span, 'http.request.method') || spanAttribute(span, 'http.method');
  const path = spanAttribute(span, 'url.path');
  return method && path ? method + ' ' + path : span.operation;
}
function relatedService(spans, predicate, service) {
  const related = spans.find((item) => predicate(item) && item.service !== service);
  return related ? related.service : '';
}
function spanDirection(span, spans) {
  const parent = relatedService(
    spans,
    (item) => item.spanId === span.parentSpanId && item.traceId === span.traceId,
    span.service,
  );
  const child = relatedService(
    spans,
    (item) => item.parentSpanId === span.spanId && item.traceId === span.traceId,
    span.service,
  );
  const peer =
    spanAttribute(span, 'server.address') ||
    spanAttribute(span, 'messaging.destination.name') ||
    spanAttribute(span, 'messaging.system') ||
    spanAttribute(span, 'rpc.system');
  switch (span.spanKind) {
    case 'server':
      return (parent || 'remote') + ' → ' + span.service;
    case 'client':
      return span.service + ' → ' + (child || peer || 'remote');
    case 'producer':
      return span.service + ' → ' + (peer || 'message broker');
    case 'consumer':
      return (peer || 'message broker') + ' → ' + span.service;
    default:
      return span.service;
  }
}
function spanPresentation(span, spans) {
  return {
    title: spanTitle(span),
    direction: spanDirection(span, spans) + ' · ' + span.spanKind,
  };
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
  for (const span of retained.spans) {
    const presentation = spanPresentation(span, retained.spans);
    const button = n('button', 'span-row');
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
      inspectSpan(root, span, a.activityId, presentation),
    );
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
