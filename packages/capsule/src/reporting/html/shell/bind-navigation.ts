export const capsuleBindNavigationScript = `
function bindNav(root, state) {
  const sections = [...root.querySelectorAll('.workspace-content>section')];
  function select(id) {
    const selected = sections.some((item) => item.id === id) ? id : 'activities';
    for (const section of sections) section.hidden = section.id !== selected;
    for (const link of root.querySelectorAll('[data-report-nav]')) {
      const active = link.dataset.reportNav === selected;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  select(state.section || location.hash.slice(1));
  for (const link of root.querySelectorAll('[data-report-nav]'))
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const id = link.dataset.reportNav;
      history.replaceState(null, '', location.pathname + location.search + '#' + id);
      select(id);
    });
}
`;
