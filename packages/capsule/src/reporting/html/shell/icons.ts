export const capsuleIconScript = `
const paths = {
  box: 'M4 4h11v11H4z M9 9h11v11H9v-5',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  clock: 'M12 7v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  stack: 'm12 3 10 5-10 5L2 8l10-5zM2 12l10 5 10-5M2 16l10 5 10-5',
  file: 'M14 3H5v18h14V8l-5-5zM14 3v5h5M8 12h8M8 16h6',
  terminal: 'm5 6 6 6-6 6M13 18h6',
  activity: 'M2 12h4l3-7 5 14 4-7h4',
  branch: 'M6 3v12a4 4 0 0 0 4 4h8M6 9h9a3 3 0 0 0 3-3V3m-3 13 3 3-3 3',
  shield: 'm12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6l8-3zm-4 9 3 3 5-6',
  info: 'M12 11v6M12 7v.1M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  chevron: 'm9 5 7 7-7 7',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', paths[name] || paths.file);
  svg.append(path);
  return svg;
}
`;
