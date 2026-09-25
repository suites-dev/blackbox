export const capsuleRenderScript = `
function render(root, d, state = {}) {
  assertReport(d);
  const view = n('div', 'capsule-view'),
    main = n('main', 'report-main'),
    content = n('div', 'report-content'),
    workspace = n('div', 'report-workspace'),
    sections = n('div', 'workspace-content');
  main.id = 'report-content';
  add(
    sections,
    overview(d),
    activities(d, state.open || [], root),
    sessionObservations(d, root),
    timeline(d, state.open || []),
    resources(d),
    placeholder(
      'manifest',
      'PLACEHOLDER · UNAVAILABLE',
      'Execution manifest',
      'Manifest selection and source inspection belong here once the producer retains a supported manifest artifact. No manifest is inferred from operational records.',
      'Not retained',
      'Placeholder retained intentionally: the Capsule report schema does not yet provide a sealed execution manifest.',
    ),
    placeholder(
      'clauses',
      'PLACEHOLDER · ASSURANCE DEFERRED',
      'Clauses and selection',
      'Clause selection, content, and verdicts are not available in this Capsule report. Activities and Docker observations are not assurance evidence.',
      'Not evaluated',
      'Placeholder retained intentionally: Capsule intent is prose and does not create assurance clauses or verdicts.',
    ),
  );
  const notice = n('div', 'report-notice');
  add(
    notice,
    icon('info'),
    p(
      'Operational record · ' +
        d.lifecycle.kind +
        ' · Raw telemetry describes retained observations. Capsule has no assurance verdict.',
    ),
  );
  add(workspace, sections, inspector());
  add(content, hero(d), metrics(d), notice, workspace);
  add(main, topbar(d), content);
  add(view, reportNav(d), main);
  root.replaceChildren(view);
  bindNav(root, state);
}
`;
