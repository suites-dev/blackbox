// Shape of one Blackbox --json document, for golden journeys (see json-shape.mjs).
// A span tree's depth varies between runs, so repeated `children[]` segments
// collapse into one.

/** `x.children[].children[].y` and `x.children[].y` are the same shape. */
function collapseChildren(path) {
  let collapsed = path;
  while (collapsed.includes('.children[].children')) {
    collapsed = collapsed.replace('.children[].children', '.children');
  }
  return collapsed;
}

/** Sorted key paths; arrays add `[]` and contribute the union of their elements' paths. */
export function keyPaths(value, prefix = '') {
  const paths = new Set();
  const stack = [{ value, path: prefix }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (Array.isArray(item.value)) {
      for (const element of item.value) stack.push({ value: element, path: `${item.path}[]` });
    } else if (item.value !== null && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value)) {
        const path = item.path === '' ? key : `${item.path}.${key}`;
        paths.add(collapseChildren(path));
        stack.push({ value: child, path });
      }
    }
  }
  return [...paths].sort();
}

export function jsonShape(input) {
  const lines = input.split('\n').filter((line) => line !== '');
  if (lines.length !== 1) {
    throw new Error(`expected exactly one JSON document, got ${String(lines.length)} lines`);
  }
  const document = JSON.parse(lines[0]);
  const limitations = Array.isArray(document.limitations)
    ? document.limitations.map((limitation) => limitation.kind).join(' ')
    : '-';
  return [
    'documents 1',
    `kind ${String(document.kind)}`,
    ...keyPaths(document).map((path) => `  ${path}`),
    `observation.status ${String(document.observation?.status ?? '-')}`,
    `context.kind ${String(document.context?.kind ?? '-')}`,
    `limitations ${limitations === '' ? '(none)' : limitations}`,
    ...(Array.isArray(document.next) ? document.next : []).map((command) => `next ${command}`),
  ].join('\n');
}
