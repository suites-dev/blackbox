#!/usr/bin/env node
// Checks that packaged agent skills only name commands, flags and catalog fields the
// installed CLI and catalog schema accept. Commands resolve against the built command
// registries, so run it after `pnpm build`.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARKER = /skill-lint:\s*not-available/;
const MARKER_LINE = '<!-- skill-lint: not-available -->';
const RUNNER_PREFIX = /^(?:\$\s+)?(?:(?:pnpm|npm|yarn)\s+exec\s+(?:--\s+)?|npx\s+(?:--\s+)?)?/;
const TOPICS = new Set(['capsule', 'catalog', 'driver', 'inst', 'skills', 'skill']);
const GLOBAL_FLAGS = new Set(['help', 'version']);
const FILE_LIKE = /\.(?:ya?ml|json|md|ts|mjs|js)$/;
// Names that appear in catalog skills but are not catalog fields: the Compose extension the
// skills forbid. Each entry needs a reason; the schema's own enum values are accepted as well.
const NON_FIELD_TERMS = new Map([
  ['x-blackbox', 'Compose extension that the skill tells the agent not to add'],
]);

/** Every `COMMANDS` entry of every built package registry, keyed by oclif id (`capsule:up`). */
export async function loadCommands(root = ROOT) {
  const commands = new Map();
  const packages = join(root, 'packages');
  for (const name of await readdir(packages)) {
    for (const path of ['dist/cli/command-registry.js', 'dist/command-registry.js']) {
      const file = join(packages, name, path);
      if (!existsSync(file)) continue;
      const { COMMANDS } = await import(pathToFileURL(file).href);
      for (const [id, command] of Object.entries(COMMANDS)) {
        const flags = { ...command.baseFlags, ...command.flags };
        const names = new Set();
        for (const [flag, definition] of Object.entries(flags)) {
          names.add(flag);
          for (const alias of definition.aliases ?? []) names.add(alias);
          if (definition.allowNo) names.add(`no-${flag}`);
        }
        commands.set(id, { hidden: command.hidden === true, flags: names });
      }
    }
  }
  if (commands.size === 0) throw new Error('no built command registries: run `pnpm build` first');
  return commands;
}

/** Property names and enum values of the catalog schema, split into top level and entry level. */
export async function loadSchemaFields(root = ROOT) {
  const schema = JSON.parse(
    await readFile(join(root, 'packages/catalog/schema/blackbox-config-v1.json'), 'utf8'),
  );
  const definitions = schema.$defs ?? {};
  const topLevel = new Set(Object.keys(schema.properties ?? {}));
  const entryLevel = new Set(Object.keys(definitions.catalogEntry?.properties ?? {}));
  const known = new Set([...topLevel, ...entryLevel]);
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    for (const name of Object.keys(node.properties ?? {})) known.add(name);
    for (const value of node.enum ?? []) if (typeof value === 'string') known.add(value);
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return { topLevel, entryLevel, known };
}

/** Command-like strings in one line: inline code spans, or fenced lines already joined. */
function commandTexts(line, fenced) {
  if (fenced) return [line.text];
  return [...line.text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

const SEGMENT_END = /\s\|\s|\s>>?\s|\s2>\s/;

function splitCommands(text, fenced, commands) {
  const found = [];
  for (const match of text.matchAll(/(?:^|[\s(`"'=])blackbox(?=\s|$)([^;&)`]*)/g)) {
    found.push(match[1].split(SEGMENT_END)[0].trim().replace(/\s+/g, ' '));
  }
  if (!fenced && found.length === 0) {
    const bare = text.replace(RUNNER_PREFIX, '').trim();
    const [first, second] = bare.split(/\s+/);
    const known = TOPICS.has(first) || commands.has(first);
    if (known && /^(?:[a-z][a-z-]*|--[a-z][a-z-]*|<[^>\s]+>)$/.test(second ?? '')) {
      found.push(bare.split(SEGMENT_END)[0].trim().replace(/\s+/g, ' '));
    }
  }
  return found;
}

/** Resolve `capsule report export --session x` against the registry. */
function resolve(argv, commands) {
  const tokens = argv.split(/\s+/).filter(Boolean);
  let id;
  let used = 0;
  const words = [];
  for (const token of tokens) {
    if (!/^[a-z][a-z0-9-]*$/.test(token)) break;
    words.push(token);
  }
  for (let count = words.length; count > 0; count -= 1) {
    const candidate = words.slice(0, count).join(':');
    if (commands.has(candidate)) {
      id = candidate;
      used = count;
      break;
    }
  }
  const rest = tokens.slice(used);
  if (id !== undefined) return { id, rest, path: words.slice(0, used).join(' ') };
  const topic = words.join(':');
  const isTopic = [...commands.keys()].some((key) => key.startsWith(`${topic}:`));
  if (words.length > 0 && isTopic) return { topic: true, rest: tokens.slice(words.length) };
  return {
    path: words.join(' ') || tokens[0] || '',
    rest: tokens.slice(Math.max(words.length, 1)),
  };
}

function flagProblem(flags, rest) {
  for (const token of rest) {
    if (token === '--') return undefined;
    if (!token.startsWith('--')) continue;
    const name = token.slice(2).split('=')[0];
    if (!/^[a-z][a-z0-9-]*$/.test(name) || GLOBAL_FLAGS.has(name)) continue;
    if (!flags.has(name)) return `unknown flag --${name}`;
  }
  return undefined;
}

/** Join backslash-continued lines inside fences and tag each line as fenced or not. */
function skillLines(text) {
  const lines = text.split('\n');
  const result = [];
  let fence;
  let block = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const fenceMatch = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(raw);
    if (fenceMatch) {
      if (fence === undefined) block += 1;
      fence = fence === undefined ? { language: fenceMatch[2] } : undefined;
      continue;
    }
    if (fence === undefined) {
      result.push({ number: index + 1, text: raw, fenced: false, language: '', block: 0 });
      continue;
    }
    let joined = raw;
    const start = index + 1;
    while (joined.endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      joined = `${joined.slice(0, -1)} ${lines[index].trim()}`;
    }
    result.push({ number: start, text: joined, fenced: true, language: fence.language, block });
  }
  return result;
}

function markerLines(lines) {
  const marked = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    if (!MARKER.test(lines[index].text)) continue;
    marked.add(lines[index].number);
    if (lines[index].text.trim() === MARKER_LINE) {
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].text.trim() === '') continue;
        marked.add(lines[next].number);
        break;
      }
    }
  }
  return marked;
}

/** `npm exec -- blackbox` and `npx blackbox` fetch a remote package when the CLI is missing. */
function runnerProblem(text) {
  for (const match of text.matchAll(/\b(?:npm\s+exec|npx)\b([^;&|)`]*)/g)) {
    const tokens = match[1].trim().split(/\s+/);
    const at = tokens.indexOf('blackbox');
    if (at !== -1 && !tokens.slice(0, at).some((token) => token === '--no')) {
      return match[0].trim().replace(/\s+/g, ' ');
    }
  }
  return undefined;
}

function checkCommands(file, lines, commands, problems) {
  const marked = markerLines(lines);
  for (const line of lines) {
    for (const text of commandTexts(line, line.fenced)) {
      const runner = runnerProblem(text);
      if (runner !== undefined && !marked.has(line.number)) {
        const message = `may download a missing CLI, use --no: ${runner}`;
        problems.push({ file, line: line.number, message });
      }
      for (const argv of splitCommands(text, line.fenced, commands)) {
        if (argv === '' || argv.startsWith('<') || argv.startsWith('[')) continue;
        const resolved = resolve(argv, commands);
        let problem;
        if (resolved.topic === true) {
          problem = flagProblem(new Set(), resolved.rest);
        } else {
          if (resolved.id === undefined) {
            if (resolved.path === '' || resolved.path.startsWith('-')) {
              // A root invocation: only the global flags exist.
              problem = flagProblem(new Set(), argv.split(/\s+/));
              if (problem === undefined) continue;
            } else {
              problem = 'unknown command';
            }
          } else if (commands.get(resolved.id).hidden) {
            problem = 'hidden command';
          } else {
            problem = flagProblem(commands.get(resolved.id).flags, resolved.rest);
          }
        }
        const label = `blackbox ${argv}`;
        if (marked.has(line.number)) {
          if (problem === undefined) {
            problems.push({
              file,
              line: line.number,
              message: `not-available marker on a command that exists: ${label}`,
            });
          }
        } else if (problem !== undefined) {
          problems.push({ file, line: line.number, message: `${problem}: ${label}` });
        }
      }
    }
  }
}

/** Fenced yaml blocks whose first key is `schemaVersion` or `catalog`: a blackbox.config.yaml. */
function blackboxConfigBlocks(lines) {
  const seen = new Set();
  const blocks = new Set();
  for (const line of lines) {
    if (!line.fenced || !/^ya?ml$/.test(line.language) || seen.has(line.block)) continue;
    const key = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line.text)?.[1];
    if (key === undefined) continue;
    seen.add(line.block);
    if (key === 'schemaVersion' || key === 'catalog') blocks.add(line.block);
  }
  return blocks;
}

function checkCatalogFields(file, lines, fields, problems) {
  const inCatalogSkill = /(^|\/)packages\/catalog\/skills\//.test(file);
  const configBlocks = blackboxConfigBlocks(lines);
  let stack = [];
  let block = 0;
  for (const line of lines) {
    if (line.block !== block) {
      block = line.block;
      stack = [];
    }
    if (line.fenced) {
      if (configBlocks.has(line.block)) checkYamlLine(file, line, stack, fields, problems);
      continue;
    }
    if (!inCatalogSkill) continue;
    for (const [, span] of line.text.matchAll(/`([^`\n]+)`/g)) {
      if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(span) || FILE_LIKE.test(span)) continue;
      if (NON_FIELD_TERMS.has(span) || fields.known.has(span)) continue;
      problems.push({
        file,
        line: line.number,
        message: `catalog field or term \`${span}\` is not in the catalog schema`,
      });
    }
  }
}

/** Track `catalog: / entries: / <system>:` nesting; check top-level and entry-level keys. */
function checkYamlLine(file, line, stack, fields, problems) {
  const match = /^(\s*)([A-Za-z][A-Za-z0-9_-]*):/.exec(line.text);
  if (match === null) return;
  const indent = match[1].length;
  const key = match[2];
  while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
  const path = stack.map((item) => item.key);
  if (path.length === 0 && !fields.topLevel.has(key)) {
    problems.push({ file, line: line.number, message: `unknown top-level catalog field ${key}` });
  } else if (path.length === 3 && path[0] === 'catalog' && path[1] === 'entries') {
    if (!fields.entryLevel.has(key)) {
      problems.push({ file, line: line.number, message: `unknown catalog entry field ${key}` });
    }
  }
  stack.push({ indent, key });
}

/** Check skill files already read into `{ path, text }` against the loaded sources. */
export function checkSkills({ files, commands, fields }) {
  const problems = [];
  for (const { path, text } of files) {
    const lines = skillLines(text);
    checkCommands(path, lines, commands, problems);
    checkCatalogFields(path, lines, fields, problems);
  }
  return problems;
}

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    else if (/\.(?:md|mmd)$/.test(entry.name)) result.push(path);
  }
  return result;
}

/** Every packaged skill file under `packages/<name>/skills/`. */
export async function packagedSkillFiles(root = ROOT) {
  const files = [];
  for (const name of await readdir(join(root, 'packages'))) {
    const skills = join(root, 'packages', name, 'skills');
    if (existsSync(skills)) {
      for (const path of (await filesIn(skills)).sort()) {
        files.push({ path: relative(root, path), text: await readFile(path, 'utf8') });
      }
    }
  }
  return files;
}

export async function checkPackagedSkills(root = ROOT) {
  const [files, commands, fields] = await Promise.all([
    packagedSkillFiles(root),
    loadCommands(root),
    loadSchemaFields(root),
  ]);
  return { files: files.length, problems: checkSkills({ files, commands, fields }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, problems } = await checkPackagedSkills();
  for (const { file, line, message } of problems) console.error(`${file}:${line}: ${message}`);
  if (problems.length > 0) process.exit(1);
  console.log(`check-skill-commands: ${files} skill files match the installed CLI and schema`);
}
