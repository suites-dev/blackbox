export const capsuleInspectorShellScript = `
function inspector() {
  const aside = n('aside', 'report-inspector');
  aside.setAttribute('aria-label', 'Raw telemetry inspector');
  const head = n('div', 'inspector-head');
  add(head, icon('branch'), n('h2', '', 'Inspector'));
  add(aside, head);
  resetInspector(aside);
  return aside;
}
function resetInspector(aside) {
  const old = aside.querySelector('.inspector-body');
  if (old) old.remove();
  const body = n('div', 'inspector-body');
  add(
    body,
    p('RAW TELEMETRY', 'eyebrow'),
    n('h3', '', 'What was observed'),
    p('Select a span from a recorded activity to inspect its retained OTEL fields.', 'muted'),
    p(
      'Only a bounded, redacted projection is shown. Process and host resource attributes, payloads, events, and free-form attributes are omitted.',
      'inspector-note',
    ),
  );
  add(aside, body);
}
`;
