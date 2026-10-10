// Runs inside the Capsule client view. It renders the causal fields of the
// report document (status, per-activity caused traces, uncaused traces and
// limitations); a report written before they existed renders without them.
export const capsuleCausalityScript = `
function shortId(id) {
  return String(id).slice(0, 8);
}
function statusText(d) {
  if (d.status === 'provisional') return 'provisional (capsule running)';
  if (d.status === 'incomplete') return 'incomplete (' + d.reason + ')';
  return d.status === 'complete' ? 'complete' : null;
}
function statusTone(d) {
  return d.status === 'complete' ? 'good' : d.status === 'incomplete' ? 'bad' : 'warn';
}
function statusBanner(d) {
  const text = statusText(d);
  const block = n('div', 'report-status');
  block.setAttribute('role', 'status');
  if (text === null) {
    add(block, n('strong', '', 'Observation status'), badge('not recorded', 'warn'),
      p('This report was written before observation status was recorded.', 'muted'));
    return block;
  }
  add(block, n('strong', '', 'Observation status'), badge(text, statusTone(d)),
    p(d.status === 'provisional'
      ? 'Observations may still arrive; export again for the final state.'
      : d.status === 'complete'
        ? 'The collector stopped cleanly; no further observations will arrive.'
        : 'Some observations may be missing; a missing observation is a limitation, not proof that an operation did not happen.', 'muted'));
  return block;
}
const EVIDENCE = {
  'state-preparation': ['State preparation', 'Prepares state. It is not a response and not a check of what was saved.'],
  'response': ['Response', 'What came back from this action. Observations are listed with it.'],
  'state-check': ['State check', 'What was saved, as this check read it. Its output is shown below.'],
};
function evidenceInfo(a, d) {
  const entry = (d.activityCausality || []).find((item) => item.activityId === a.activityId);
  const kind = entry ? entry.evidence
    : a.purpose === 'setup' ? 'state-preparation' : a.purpose === 'inspection' ? 'state-check' : 'response';
  return { kind, label: EVIDENCE[kind][0], note: EVIDENCE[kind][1], entry };
}
function limitationText(l) {
  switch (l.kind) {
    case 'observation-provisional': return 'Observation is provisional: the capsule is running and more spans may arrive.';
    case 'observation-incomplete': return 'Observation is incomplete: ' + l.reason + '.';
    case 'causality-unknown': return 'Cause unknown: no trace context links trace ' + shortId(l.trace) + ' to this activity.';
    case 'untraced': return 'Untraced: no driver was used, so no trace context was sent.';
    case 'context-not-carried': return 'Context not carried: ' + l.resource + ' is shared state.';
    case 'context-injection-failed': return 'Context injection failed (' + l.carrier + '): ' + l.message;
    case 'orphan-span': return 'Orphan span ' + shortId(l.spanId) + ' in trace ' + shortId(l.trace) + ': its parent is not in the retained trace.';
    case 'observation-unavailable': return 'Observation unavailable: trace ' + shortId(l.trace) + ' is ' + (l.reason === 'corrupt' ? 'unreadable' : 'not retained') + '.';
    default: return 'Unsupported limitation.';
  }
}
function limitationsBlock(list, heading) {
  if (!list || !list.length) return null;
  const block = n('div', 'limitations'), items = n('ul');
  add(block, n('h4', '', heading));
  for (const item of list) add(items, n('li', '', limitationText(item)));
  add(block, items);
  return block;
}
const ORPHAN_TEXT = { 'not-yet-observed': '(parent not yet observed)', 'not-retained': '(parent not retained)' };
function nodeLabel(node) {
  const parts = [node.service, node.title, node.result, node.failure || ''];
  if (node.orphan) parts.push(ORPHAN_TEXT[node.orphan]);
  return parts.filter(Boolean).join('  ');
}
function spanTreeList(roots) {
  const list = n('ul', 'span-tree');
  const stack = [...roots].reverse().map((node) => ({ node, into: list }));
  while (stack.length) {
    const { node, into } = stack.pop();
    const item = n('li', 'span-tree-node');
    add(item, n('span', 'span-tree-label', nodeLabel(node)));
    if (node.children.length) {
      const children = n('ul');
      add(item, children);
      for (const child of [...node.children].reverse()) stack.push({ node: child, into: children });
    }
    add(into, item);
  }
  return list;
}
function causedTraces(a, d) {
  const info = evidenceInfo(a, d);
  if (!info.entry) return null;
  const block = n('div', 'raw-telemetry caused-traces');
  add(block, n('h4', '', 'Caused by this activity'),
    p('Linked by trace context: the trace ID equals this activity\\'s context trace ID.', 'telemetry-caption'));
  if (!info.entry.causedTraces.length)
    add(block, p('No trace is linked to this activity by trace context.', 'telemetry-empty'));
  for (const trace of info.entry.causedTraces) {
    add(block, add(n('div', 'session-trace-head'), n('strong', '', 'Trace ' + trace.traceId),
      badge(trace.spanCount + (trace.spanCount === 1 ? ' span' : ' spans')),
      badge(trace.services.join(', ') || 'no services')),
      spanTreeList(trace.tree));
  }
  return block;
}
function activityLimitations(a, d) {
  const info = evidenceInfo(a, d);
  return info.entry ? limitationsBlock(info.entry.limitations, 'Limitations') : null;
}
function uncausedEntry(d, trace) {
  return (d.uncaused || []).find((item) => item.trace === trace.traceId) || null;
}
function uncausedNotes(d, entry) {
  if (!entry) return [];
  const placed = entry.placedAfter
    ? 'Placed after activity ' + shortId(entry.placedAfter) + ' by time (display order only).'
    : 'Placed before the first activity by time (display order only).';
  const notes = [p(placed, 'telemetry-caption')];
  if (entry.rootTitle) notes.push(p('Root · ' + [entry.rootService, entry.rootTitle].filter(Boolean).join('  '), 'telemetry-caption'));
  if (entry.placedAfter) notes.push(
    p('⚠ Blackbox cannot prove that ' + shortId(entry.placedAfter) + ' caused ' + shortId(entry.trace) + '.', 'muted'),
    p('Both belong to capsule ' + d.session.sessionId + ', but no trace context links them.', 'muted'));
  return notes;
}
`;
