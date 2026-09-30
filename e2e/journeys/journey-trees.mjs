// Canonical sibling order for span trees in show output, applied to RAW output
// before normalization. Span start times are only millisecond precise, so the
// order of siblings that start close together varies between runs; goldens
// assert every span, its depth and its parent, not that order. Blackbox's own
// ordering is covered by unit tests.

const CONNECTOR = /^((?:│ {2}| {3})*)([├└]─ )/u;

/** Parses tree lines (already stripped of the block indent) into nodes. */
function parseTree(lines) {
  const roots = [];
  const stack = [];
  for (const line of lines) {
    const match = CONNECTOR.exec(line);
    const depth = match === null ? 0 : match[1].length / 3 + 1;
    const node = { label: match === null ? line : line.slice(match[0].length), children: [] };
    stack.length = depth;
    if (depth === 0) roots.push(node);
    else if (stack[depth - 1] === undefined) return null;
    else stack[depth - 1].children.push(node);
    stack[depth] = node;
  }
  return roots;
}

function sortTree(nodes, key) {
  for (const node of nodes) sortTree(node.children, key);
  nodes.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function subtreeKey(labelOf) {
  const key = (node) =>
    `${labelOf(node)}\n${node.children.map((child) => ` ${key(child)}`).join('\n')}`;
  return key;
}

function renderTree(nodes, indent) {
  const lines = [];
  const walk = (node, prefix, connector) => {
    lines.push(`${indent}${prefix}${connector}${node.label}`);
    const continuation = connector === '' ? '' : connector === '└─ ' ? '   ' : '│  ';
    node.children.forEach((child, index) =>
      walk(child, `${prefix}${continuation}`, index === node.children.length - 1 ? '└─ ' : '├─ '),
    );
  };
  for (const node of nodes) walk(node, '', '');
  return lines;
}

/** Sorts one tree block (lines sharing `indent`); unparseable blocks stay as they are. */
function canonicalTreeBlock(lines, indent) {
  const roots = parseTree(lines.map((line) => line.slice(indent.length)));
  if (roots === null) return lines;
  sortTree(
    roots,
    subtreeKey((node) => node.label),
  );
  return renderTree(roots, indent);
}

/** Reorders `--spans` rows into canonical tree order, keeping each row's text. */
function canonicalSpanRows(header, rows) {
  const columns = ['SPAN', 'PARENT', 'SERVICE', 'KIND', 'TITLE', 'RESULT', 'DURATION'].map((name) =>
    header.indexOf(name),
  );
  if (columns.some((column) => column < 0)) return rows;
  const cell = (row, index) =>
    row.slice(columns[index], index + 1 < columns.length ? columns[index + 1] : undefined).trim();
  const nodes = rows.map((row) => ({
    row,
    id: cell(row, 0),
    parent: cell(row, 1),
    // Everything but the IDs and the duration, which vary between runs.
    label: [2, 3, 4, 5].map((index) => cell(row, index)).join('|'),
    children: [],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];
  for (const node of nodes) {
    const parent = byId.get(node.parent);
    if (parent === undefined || parent === node) roots.push(node);
    else parent.children.push(node);
  }
  sortTree(
    roots,
    subtreeKey((node) => node.label),
  );
  const ordered = [];
  const walk = (node) => {
    ordered.push(node.row);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return ordered.length === rows.length ? ordered : rows;
}

/**
 * Canonicalizes every span tree in show output: the SPANS block of
 * `show <activity>`, the tree under a `trace … spans` header, and the rows of
 * `show <trace> --spans`. Everything else is returned unchanged.
 */
export function canonicalizeTrees(text) {
  const lines = text.split('\n');
  const out = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    out.push(line);
    index += 1;
    let indent = null;
    if (line === '  SPANS') indent = '    ';
    else if (/^trace \S+ · capsule \S+ · \d+ spans · /u.test(line)) indent = '  ';
    if (indent === null) continue;
    // The block ends at the first line without its indent ("later in this
    // capsule", a ⚠ line, a → suggestion, or the end of the output).
    const block = [];
    while (index < lines.length && lines[index].startsWith(indent)) {
      block.push(lines[index]);
      index += 1;
    }
    if (block.length > 0 && block[0].startsWith('  SPAN ')) {
      out.push(block[0], ...canonicalSpanRows(block[0], block.slice(1)));
    } else {
      out.push(...canonicalTreeBlock(block, indent));
    }
  }
  return out.join('\n');
}
