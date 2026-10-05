// Runs inside the Capsule client view. Spans are listed as a tree, with time.
export const capsuleTelemetryOrderScript = `
function spanStartNanos(span) {
  return span.startTimeUnixNano ? BigInt(span.startTimeUnixNano) : null;
}
function compareSpanStarts(left, right) {
  const a = spanStartNanos(left), b = spanStartNanos(right);
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function spanChildren(sorted) {
  const ids = new Set(sorted.map((span) => span.spanId)), children = new Map(), roots = [];
  for (const span of sorted) {
    const parent = span.parentSpanId;
    if (parent && parent !== span.spanId && ids.has(parent)) {
      children.set(parent, [...(children.get(parent) || []), span]);
    } else roots.push(span);
  }
  return { roots, children };
}
/** Spans in tree order (each parent before its children, siblings by start time), with depth. */
function spanTreeOrder(spans) {
  const sorted = [...spans].sort(compareSpanStarts), { roots, children } = spanChildren(sorted);
  const ordered = [], seen = new Set(), stack = [...roots].reverse().map((span) => ({ span, depth: 0 }));
  while (stack.length) {
    const item = stack.pop();
    if (seen.has(item.span.spanId)) continue;
    seen.add(item.span.spanId);
    ordered.push(item);
    const next = children.get(item.span.spanId) || [];
    for (const child of [...next].reverse()) stack.push({ span: child, depth: item.depth + 1 });
  }
  // A span in a parent cycle is never reached from a root: it is listed as one.
  for (const span of sorted) if (!seen.has(span.spanId)) ordered.push({ span, depth: 0 });
  return ordered;
}
function traceOrigin(spans) {
  let origin = null;
  for (const span of spans) {
    const start = spanStartNanos(span);
    if (start !== null && (origin === null || start < origin)) origin = start;
  }
  return origin;
}
function compareTraceStarts(left, right) {
  const a = left.kind === 'available' ? traceOrigin(left.spans) : null;
  const b = right.kind === 'available' ? traceOrigin(right.spans) : null;
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function microsText(micros) {
  if (micros < 1000) return (micros / 1000).toFixed(2) + ' ms';
  return micros < 1000000 ? (micros / 1000).toFixed(1) + ' ms' : (micros / 1000000).toFixed(2) + ' s';
}
/** '+<offset from the trace start> · <duration>', each part only when its times are known. */
function spanTimingText(span, origin) {
  const start = spanStartNanos(span);
  if (start === null) return 'time unavailable';
  const offset = origin === null ? '' : '+' + microsText(Number((start - origin) / 1000n));
  const duration = span.endTimeUnixNano
    ? microsText(Number((BigInt(span.endTimeUnixNano) - start) / 1000n)) : '';
  return [offset, duration].filter(Boolean).join(' · ');
}
/** Depth and origin for each row of one span list. */
function spanLayout(spans) {
  const ordered = spanTreeOrder(spans);
  return {
    spans: ordered.map((item) => item.span),
    depth: new Map(ordered.map((item) => [item.span.spanId, item.depth])),
    origin: traceOrigin(spans),
  };
}
`;
