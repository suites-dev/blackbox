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
// patch) is spec, any other changed entry is code. A renamed path counts under
// both its old and its new name. The runner-policy baseline is spec too: every
// path a config file names as the Blackbox reporter's `policy.baseline`, at the
// merge base or at HEAD, joins the spec class, so one change cannot alter the
// runner code or config and also accept the result in the baseline. Usage:
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
  ],
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
      source += glob[index].replace(/[$()+.?[\\\]^{|}]/, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const matchesAny = (path, globs) => globs.some((glob) => globToRegExp(glob).test(path));

/**
 * 'spec' | 'neutral' | 'manifest' | 'code' for one repository-relative path.
 * `classes.specFiles` holds exact spec paths, such as discovered baselines.
 */
export function classifyPath(path, classes = REPOSITORY_CLASSES) {
  if (classes.specFiles?.includes(path) || matchesAny(path, classes.spec)) {
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
    const side = entry.path.some((key) => namesLibrary(key, classes.libraries)) ? 'spec' : 'code';
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

// Config modules that can name a reporter option, such as playwright.config.ts.
const CONFIG = /(^|\/)[^/]*\.config\.[cm]?[jt]s$/;
const BASELINE_OPTION = /\bbaseline\s*:\s*([^,}\n]*)/g;
const STRING_LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

/**
 * Repository paths a config module names as `baseline:`, resolved from the
 * config's directory as the reporter resolves them. Every string literal in
 * the value counts, so `process.env.X ?? './baseline.json'` yields its
 * fallback. Interpolated, absolute and out-of-repository paths are skipped.
 */
export function baselineReferences(configPath, text) {
  const paths = [];
  for (const [, value] of text.matchAll(BASELINE_OPTION)) {
    for (const [, , literal] of value.matchAll(STRING_LITERAL)) {
      if (literal === '' || literal.includes('${') || posix.isAbsolute(literal)) {
        continue;
      }
      const path = posix.normalize(posix.join(posix.dirname(configPath), literal));
      if (path !== '..' && !path.startsWith('../') && !paths.includes(path)) {
        paths.push(path);
      }
    }
  }
  return paths;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function contentAt(revision, path, cwd) {
  return MANIFEST.test(path) ? git(['cat-file', 'blob', `${revision}:${path}`], cwd) : '';
}

/** The baselines that config modules at `revision` name. */
function baselinesAt(revision, cwd) {
  const paths = [];
  for (const path of git(['ls-tree', '-r', '-z', '--name-only', revision], cwd).split('\0')) {
    if (!CONFIG.test(path)) {
      continue;
    }
    for (const baseline of baselineReferences(
      path,
      git(['cat-file', 'blob', `${revision}:${path}`], cwd),
    )) {
      if (!paths.includes(baseline)) {
        paths.push(baseline);
      }
    }
  }
  return paths;
}

/**
 * Reads the changes between the merge base of `base` and `head`, splitting a
 * rename or copy into its old path (removed) and its new path (added), and the
 * policy baselines named on either side.
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
  const baselines = [...new Set([...baselinesAt(mergeBase, cwd), ...baselinesAt(head, cwd)])];
  return { mergeBase, changes, baselines };
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
    const { mergeBase, changes, baselines } = readChanges({ ...options, cwd: process.cwd() });
    const classes = { ...REPOSITORY_CLASSES, specFiles: baselines };
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
