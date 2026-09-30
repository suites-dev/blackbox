#!/usr/bin/env node
// The shape of one Blackbox --json document, for golden journeys. Reads stdin
// only and takes no arguments. Prints how many documents arrived, `kind`, every
// key path (never a value), `observation.status`, `context.kind`, the
// `limitations[].kind` list and `next`; the runner normalizes IDs as usual.
// A span tree's depth varies between runs, so repeated `children[]` segments
// collapse into one.
import { realpathSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { pathToFileURL } from 'node:url';

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

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  if (process.argv.length > 2) {
    console.error('json-shape.mjs takes no arguments; it reads one document on stdin');
    process.exit(2);
  }
  try {
    console.log(jsonShape(await text(process.stdin)));
  } catch (error) {
    console.error(`json-shape.mjs: ${error.message}`);
    process.exitCode = 1;
  }
}
