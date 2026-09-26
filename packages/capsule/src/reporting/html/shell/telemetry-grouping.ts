export const capsuleTelemetryGroupingScript = `
function spanGrouping(span) {
  const method =
    spanAttribute(span, 'http.request.method') || spanAttribute(span, 'http.method');
  if (method) return { kind: 'ungrouped' };
  let resource = spanPeer(span);
  if (!resource && span.operation === 'dns.lookup') resource = 'DNS';
  if (!resource && span.operation === 'tcp.connect') resource = 'TCP';
  if (!resource) return { kind: 'ungrouped' };
  return {
    kind: 'resource',
    key: span.service + ' → ' + resource,
    label: resource,
    direction: span.service + ' → ' + resource,
  };
}
function telemetryRuns(spans) {
  const runs = [];
  for (const span of spans) {
    const grouping = spanGrouping(span), last = runs[runs.length - 1];
    if (
      grouping.kind === 'resource' &&
      last &&
      last.kind === 'resource-run' &&
      last.key === grouping.key
    ) {
      last.spans.push(span);
    } else if (grouping.kind === 'resource') {
      runs.push({
        kind: 'resource-run',
        key: grouping.key,
        label: grouping.label,
        direction: grouping.direction,
        spans: [span],
      });
    } else {
      runs.push({ kind: 'span', span });
    }
  }
  return runs;
}
`;
