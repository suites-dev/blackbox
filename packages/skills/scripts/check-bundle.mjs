import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function files(directory) {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['dist', '.validation', 'node_modules'].includes(item.name)) {
      continue;
    }
    const path = resolve(directory, item.name);
    if (item.isSymbolicLink()) {
      throw new Error('Bundle must not contain symlinks.');
    }
    if (item.isDirectory()) {
      output.push(...await files(path));
    } else {
      output.push(path);
    }
  }
  return output;
}

const all = await files(root);
let links = 0;
for (const path of all) {
  if (!path.endsWith('.md')) {
    continue;
  }
  const text = await readFile(path, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (/^(https?:|#)/u.test(target)) {
      continue;
    }
    const clean = decodeURIComponent(target.split('#')[0]);
    const destination = resolve(dirname(path), clean);
    const local = relative(root, destination);
    if (local === '..' || local.startsWith(`..${sep}`) || local.startsWith(sep)) {
      throw new Error('Relative link escapes the portable bundle.');
    }
    if (!(await stat(destination)).isFile()) {
      throw new Error('Relative link must resolve to a file.');
    }
    links += 1;
  }
}
const manifest = JSON.parse(await readFile(resolve(root, 'bundle.json'), 'utf8'));
for (const entry of [manifest.entrypoint, ...manifest.skills, ...manifest.schemas, ...manifest.diagrams]) {
  if (!all.includes(resolve(root, entry))) {
    throw new Error('Manifest entry does not resolve.');
  }
}
process.stdout.write(JSON.stringify({ kind: 'accepted', files: all.length, localLinks: links }) + '\n');
