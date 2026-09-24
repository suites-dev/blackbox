export const capsuleTelemetryPresentationScript = `
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
function spanPeer(span) {
  return (
    spanAttribute(span, 'server.address') ||
    spanAttribute(span, 'messaging.destination.name') ||
    spanAttribute(span, 'messaging.system') ||
    spanAttribute(span, 'rpc.system')
  );
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
  const peer = spanPeer(span);
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
`;
