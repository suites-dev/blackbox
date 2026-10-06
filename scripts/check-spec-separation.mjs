import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

// Spec/code separation gate (hard rule 2 of the Gherkin input design): one
// change may alter the accepted expectations (spec) or the code they judge,
// never both. Every path changed between the merge base and HEAD gets a class:
//   spec     feature files, the Gherkin project files and the step library;
//   neutral  a short explicit allowlist that may ride along with either side;
//   code     everything else (deny by default), including the Blackbox runtime
//            packages, because they produce the verdict.
// package.json, pnpm-lock.yaml and pnpm-workspace.yaml are read by content: an
// entry that names the step-library package (version, catalog, override,
// patch) or the script CI runs the Gherkin features with is spec, any other
// changed entry is code. A renamed path counts under both its old and its new
// name.
// How a run is configured is spec too, because code running inside Playwright
// (a reporter, a global setup) can write any run or policy manifest: Playwright
// configs, project reporters, the Gherkin CI workflow and its run script, and
// every path a config module names as the Blackbox reporter's
// `policy.baseline`, as a local reporter, or as `globalSetup` or
// `globalTeardown`, at the merge base or at HEAD. So one change cannot alter
// code and also how its run is judged. Usage:
//   node scripts/check-spec-separation.mjs --base <ref> [--head <ref>]
// CI passes the pull request's base and runs the base branch's copy of this
// file from a temporary directory, so keep it self-contained (Node built-ins
// only).

export const REPOSITORY_CLASSES = {
  spec: [
    'e2e/features/**',
    'packages/gherkin/src/library/**',
    '**/blackbox.gherkin.json',
    '**/blackbox.policy.json',
    'packages/playwright/src/testing/policy/baseline.json',
    '**/patches/@suites__blackbox-gherkin@*.patch',
    '**/playwright.config.*',
    '**/playwright.*.config.*',
    'e2e/reporters/**',
    // The Gherkin features lane and the script that runs Playwright for it.
    '.github/workflows/e2e.yml',
    'demo/support/gherkin-test.sh',
  ],
  // Manifest entries that are spec, by manifest path and key path prefix.
  specEntries: { 'package.json': [['scripts', 'test:e2e:gherkin']] },
  // Spec patterns win, so Markdown inside a spec path stays spec.
  neutral: ['**/*.md'],
  // Packages whose dependency entries are step definitions.
  libraries: ['@suites/blackbox-gherkin'],
};

const MANIFEST = /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;

/** Translates the `*` and `**` glob subset used by the classes above. */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    if (glob.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
    } else if (glob.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (glob[index] === '*') {
      source += '[^/]*';
    } else {
      source += glob[index].replace(/[$()+.?[\\\]^{|}]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const matchesAny = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path));

/** 'spec' | 'neutral' | 'manifest' | 'code' for one repository-relative path. */
export function classifyPath(path, classes = REPOSITORY_CLASSES) {
  if (matchesAny(path, classes.spec)) {
    return 'spec';
  }
  if (matchesAny(path, classes.neutral)) {
    return 'neutral';
  }
  return MANIFEST.test(path) ? 'manifest' : 'code';
}

/** Whether a key names a library package, bare or with a version or peer suffix. */
function namesLibrary(key, libraries) {
  return libraries.some((name) =>
    new RegExp(
      `(?:^|[\\s>/('"])${name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')}(?=$|[@\\s()'":])`,
    ).test(key),
  );
}

/** Flattens JSON into key paths; array scalars become keys so they are matched too. */
function jsonEntries(value, path = [], entries = []) {
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    const children = Array.isArray(value)
      ? value.map((child) => [null, child])
      : Object.entries(value);
    if (children.length === 0) {
      entries.push({ path, value: JSON.stringify(value) });
    }
    for (const [key, child] of children) {
      if (key === null && (child === null || typeof child !== 'object')) {
        entries.push({ path: [...path, JSON.stringify(child)], value: '' });
      } else {
        jsonEntries(child, [...path, key ?? '[]'], entries);
      }
    }
  } else {
    entries.push({ path, value: JSON.stringify(value) });
  }
  return entries;
}

const YAML_KEY = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^\s#'"][^:#]*?)\s*:(?:\s+(.*))?$/;

/**
 * One entry per meaningful line of a pnpm YAML file, keyed by the chain of
 * keys that encloses it. This is not a YAML parser: it only has to attribute
 * every changed line to the keys above it, and every non-comment line yields
 * an entry, so no edit can go unattributed.
 */
function yamlEntries(text) {
  const entries = [];
  const stack = [];
  for (const line of text.split(/\r?\n/)) {
    const content = line.trim();
    if (content === '' || content === '---' || content.startsWith('#')) {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    while (stack.length > 0 && stack.at(-1).indent >= indent) {
      stack.pop();
    }
    const match = content.startsWith('-') ? null : YAML_KEY.exec(content);
    const key = match ? match[1] : content;
    entries.push({ path: [...stack.map((frame) => frame.key), key], value: match?.[2] ?? '' });
    stack.push({ indent, key });
  }
  return entries;
}

function manifestEntries(path, text) {
  if (text === null) {
    return [];
  }
  if (!path.endsWith('.json')) {
    return yamlEntries(text);
  }
  try {
    return jsonEntries(JSON.parse(text));
  } catch (error) {
    throw new Error(`cannot classify ${path}: ${error.message}`);
  }
}

/** Entries present on one side only, counted as multisets. */
function changedEntries(before, after) {
  const identity = (entry) => JSON.stringify([...entry.path, entry.value]);
  const counts = new Map();
  for (const entry of before) {
    counts.set(identity(entry), (counts.get(identity(entry)) ?? 0) + 1);
  }
  const changed = [];
  for (const entry of after) {
    const remaining = counts.get(identity(entry)) ?? 0;
    if (remaining > 0) {
      counts.set(identity(entry), remaining - 1);
    } else {
      changed.push(entry);
    }
  }
  for (const entry of before) {
    const remaining = counts.get(identity(entry)) ?? 0;
    if (remaining > 0) {
      counts.set(identity(entry), remaining - 1);
      changed.push(entry);
    }
  }
  return changed;
}

/**
 * Splits one manifest's change into spec and code reasons. A manifest that
 * changed without a changed entry (comments, whitespace) is code.
 */
export function classifyManifest(path, before, after, classes = REPOSITORY_CLASSES) {
  const result = { spec: [], code: [] };
  const changed = changedEntries(manifestEntries(path, before), manifestEntries(path, after));
  for (const entry of changed) {
    const side =
      entry.path.some((key) => namesLibrary(key, classes.libraries)) ||
      (classes.specEntries?.[path] ?? []).some((prefix) =>
        prefix.every((key, index) => entry.path[index] === key),
      )
        ? 'spec'
        : 'code';
    const reason = entry.path.join(' > ');
    if (!result[side].includes(reason)) {
      result[side].push(reason);
    }
  }
  if (changed.length === 0) {
    result.code.push('formatting or comments');
  }
  return result;
}

/**
 * Classifies changes of the form { path, before, after }, where before and
 * after are the file contents (null when absent). Returns the spec, code and
 * neutral paths with the reason each manifest landed where it did.
 */
export function classifyChanges(changes, classes = REPOSITORY_CLASSES) {
  const result = { spec: [], code: [], neutral: [] };
  for (const { path, before, after } of changes) {
    const kind = classifyPath(path, classes);
    if (kind !== 'manifest') {
      result[kind].push({ path });
      continue;
    }
    const sides = classifyManifest(path, before, after, classes);
    for (const side of ['spec', 'code']) {
      if (sides[side].length > 0) {
        result[side].push({ path, reason: sides[side][0], more: sides[side].length - 1 });
      }
    }
  }
  return result;
}

/** A change may contain spec paths or code paths, not both. */
export function checkSeparation(result) {
  if (result.spec.length === 0 || result.code.length === 0) {
    return [];
  }
  const names = (entries) => [...new Set(entries.map((entry) => entry.path))].join(', ');
  return [
    `this change mixes spec and code. Split it into a spec-only change and a code-only change. Spec: ${names(result.spec)}. Code: ${names(result.code)}.`,
  ];
}

// Config modules that can name a reporter, a baseline or a global setup.
const CONFIG = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;
const STRING_LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const QUOTED = String.raw`(?:'[^'\n]*'|"[^"\n]*")`;
const JOINED = new RegExp(
  String.raw`\b(?:path\.)?(?:join|resolve)\(\s*(?:import\.meta\.dirname|__dirname)\s*((?:,\s*${QUOTED}\s*)+)\)`,
  'g',
);
// Options whose every string literal is a path, and options where only
// `./` or `../` literals are (a reporter entry also holds built-in reporter
// names, package names and output files).
const PATH_OPTIONS = ['baseline', 'globalSetup', 'globalTeardown'];
const RELATIVE_PATH_OPTIONS = ['reporter'];

/** The end index of the string literal or comment that starts at `index`. */
function skipLiteral(text, index) {
  const char = text[index];
  if (char === '/' && text[index + 1] === '/') {
    const end = text.indexOf('\n', index);
    return end === -1 ? text.length : end;
  }
  if (char === '/' && text[index + 1] === '*') {
    const end = text.indexOf('*/', index + 2);
    return end === -1 ? text.length : end + 1;
  }
  for (let end = index + 1; end < text.length; end += 1) {
    if (text[end] === '\\') {
      end += 1;
    } else if (text[end] === char) {
      return end;
    }
  }
  return text.length;
}

/** The source of each `key:` value, up to the comma or bracket that ends it. */
function optionValues(text, key) {
  const values = [];
  for (const match of text.matchAll(new RegExp(String.raw`(?<![\w$.])${key}\s*:`, 'g'))) {
    const start = match.index + match[0].length;
    let depth = 0;
    let index = start;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (`'"\``.includes(char) || (char === '/' && '/*'.includes(text[index + 1]))) {
        index = skipLiteral(text, index);
      } else if ('([{'.includes(char)) {
        depth += 1;
      } else if (')]}'.includes(char)) {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      } else if (depth === 0 && ',;'.includes(char)) {
        break;
      }
    }
    values.push(text.slice(start, index));
  }
  return values;
}

/**
 * Spec globs for the paths a config module names as the Blackbox reporter's
 * `policy.baseline`, as a local reporter, or as `globalSetup` or
 * `globalTeardown`, resolved from the config's directory as Playwright and
 * the reporter resolve them. `join(import.meta.dirname, 'a', 'b.ts')` counts,
 * and so does the `'./baseline.json'` fallback of `process.env.X ?? ...`. A
 * path without an extension also covers its module files. Interpolated,
 * absolute and out-of-repository paths are skipped.
 */
export function configReferences(configPath, text) {
  const globs = [];
  const add = (relative) => {
    if (relative === '' || relative.includes('${') || posix.isAbsolute(relative)) {
      return;
    }
    const path = posix.normalize(posix.join(posix.dirname(configPath), relative));
    if (path === '..' || path.startsWith('../')) {
      return;
    }
    const candidates = posix.extname(path) === '' ? [path, `${path}.*`, `${path}/index.*`] : [path];
    for (const glob of candidates) {
      if (!globs.includes(glob)) {
        globs.push(glob);
      }
    }
  };
  for (const [keys, relativeOnly] of [
    [PATH_OPTIONS, false],
    [RELATIVE_PATH_OPTIONS, true],
  ]) {
    for (const value of keys.flatMap((key) => optionValues(text, key))) {
      const rest = value.replace(JOINED, (_, parts) => {
        add(posix.join(...[...parts.matchAll(STRING_LITERAL)].map((part) => part[2])));
        return '';
      });
      for (const [, , literal] of rest.matchAll(STRING_LITERAL)) {
        if (!relativeOnly || /^\.\.?\//.test(literal)) {
          add(literal);
        }
      }
    }
  }
  return globs;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function contentAt(revision, path, cwd) {
  return MANIFEST.test(path) ? git(['cat-file', 'blob', `${revision}:${path}`], cwd) : '';
}

/**
 * The spec globs that project config modules at `revision` name. Configs under
 * packages/ belong to the Blackbox runtime's own tests and name the runtime's
 * reporter, which produces the verdict and so stays code.
 */
function referencesAt(revision, cwd) {
  const globs = [];
  for (const path of git(['ls-tree', '-r', '-z', '--name-only', revision], cwd).split('\0')) {
    if (!CONFIG.test(path) || path.startsWith('packages/')) {
      continue;
    }
    for (const glob of configReferences(
      path,
      git(['cat-file', 'blob', `${revision}:${path}`], cwd),
    )) {
      if (!globs.includes(glob)) {
        globs.push(glob);
      }
    }
  }
  return globs;
}

/**
 * Reads the changes between the merge base of `base` and `head`, splitting a
 * rename or copy into its old path (removed) and its new path (added), and the
 * spec globs that config modules name on either side.
 */
export function readChanges({ base, head = 'HEAD', cwd }) {
  const mergeBase = git(['merge-base', base, head], cwd).trim();
  const fields = git(
    ['diff', '--name-status', '-z', '--find-renames', '--no-ext-diff', mergeBase, head, '--'],
    cwd,
  ).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index];
    if (/^[RC]/.test(status)) {
      const [from, to] = [fields[index + 1], fields[index + 2]];
      changes.push({ path: from, before: contentAt(mergeBase, from, cwd), after: null });
      changes.push({ path: to, before: null, after: contentAt(head, to, cwd) });
      index += 3;
    } else {
      const path = fields[index + 1];
      changes.push({
        path,
        before: status === 'A' ? null : contentAt(mergeBase, path, cwd),
        after: status === 'D' ? null : contentAt(head, path, cwd),
      });
      index += 2;
    }
  }
  const references = [...new Set([...referencesAt(mergeBase, cwd), ...referencesAt(head, cwd)])];
  return { mergeBase, changes, references };
}

function describe(entry) {
  if (!entry.reason) {
    return entry.path;
  }
  const more = entry.more > 0 ? ` and ${entry.more} more` : '';
  return `${entry.path} (${entry.reason}${more})`;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--base', '--head'].includes(args[index]) || args[index + 1] === undefined) {
      throw new Error(`unexpected argument ${args[index]}`);
    }
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!options.base) {
    throw new Error('--base <ref> is required');
  }
  return options;
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  let report;
  try {
    const options = parseArguments(argv.slice(2));
    const { mergeBase, changes, references } = readChanges({ ...options, cwd: process.cwd() });
    const classes = { ...REPOSITORY_CLASSES, spec: [...REPOSITORY_CLASSES.spec, ...references] };
    report = { mergeBase, result: classifyChanges(changes, classes) };
  } catch (error) {
    console.error(`error spec-separation: ${error.message}`);
    console.error('usage: node scripts/check-spec-separation.mjs --base <ref> [--head <ref>]');
    exit(2);
  }
  const { mergeBase, result } = report;
  console.log(
    `spec-separation: merge base ${mergeBase.slice(0, 12)}; spec ${result.spec.length}, code ${result.code.length}, neutral ${result.neutral.length} changed paths`,
  );
  for (const side of ['spec', 'code', 'neutral']) {
    for (const entry of result[side]) {
      console.log(`  ${side.padEnd(7)} ${describe(entry)}`);
    }
  }
  const problems = checkSeparation(result);
  for (const problem of problems) {
    console.error(`error spec-separation: ${problem}`);
  }
  if (problems.length > 0) {
    exit(1);
  }
}
