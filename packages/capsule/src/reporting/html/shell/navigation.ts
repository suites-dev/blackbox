export const capsuleNavigationScript = `
function topbar(d) {
  const bar = n('header', 'report-topbar');
  add(
    bar,
    icon('box'),
    n('span', '', 'Experiments'),
    icon('chevron'),
    n('strong', '', d.session.title),
    badge('Capsule'),
  );
  return bar;
}
function reportNav(d) {
  const rail = n('nav', 'report-rail');
  rail.setAttribute('aria-label', 'Report sections');
  const brand = n('div', 'report-brand');
  add(brand, icon('box'), n('strong', '', 'blackbox'));
  const project = n('div', 'project-box');
  add(project, icon('stack'), n('span', '', d.session.system));
  add(
    rail,
    brand,
    project,
    p('Experiment', 'rail-label'),
    navLink('overview', 'Overview', null, 'grid'),
    navLink('activities', 'Activities', d.activities.length, 'terminal'),
    navLink('timeline', 'Startup timeline', d.progress.length, 'clock'),
    navLink('resources', 'Resources', d.resources.containers.length, 'stack'),
    p('Specification', 'rail-label'),
    navLink('manifest', 'Manifest', null, 'file'),
    navLink('clauses', 'Clauses', null, 'shield'),
    p('Operational report · no assurance verdict', 'rail-footer'),
  );
  return rail;
}
`;
