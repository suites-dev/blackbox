// Golden journey format, normalization and comparison.
//
//   $ <cmd>                       compared command (stdout and stderr combined)
//   #! capture <VAR> <extractor>  set VAR from the previous command's RAW output
//   #! timeout <seconds>          timeout for the next command
//   anything else                 expected output of the preceding command

/**
 * The only captures a golden can name. Patterns are fixed here, never built
 * from golden text, and each takes its first group from the first matching line.
 */
export const CAPTURES = Object.freeze({
  'capsule-up': /^capsule (\S+) is up/mu,
  activity: /^activity ([0-9a-f-]+) · /mu,
  'current-row': /^\* (\S+) /mu,
  'single-token': /^(\S+)$/mu,
});

export const DEFAULT_TIMEOUT_MS = 120_000;
export const UP_TIMEOUT_MS = 300_000;

export function parseGolden(text) {
  const items = [];
  let current = null;
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (line.startsWith('$ ')) {
      current = { kind: 'command', command: line.slice(2), expected: [] };
      items.push(current);
    } else if (line.startsWith('#! ')) {
      items.push(parseDirective(line));
      current = null;
    } else if (current !== null) {
      current.expected.push(line);
    } else {
      throw new Error(`Expected output without a preceding command: ${line}`);
    }
  }
  return items;
}

function parseDirective(line) {
  const capture = /^#! capture ([A-Za-z_][A-Za-z0-9_]*) ([a-z-]+)$/u.exec(line);
  if (capture !== null) {
    const pattern = CAPTURES[capture[2]];
    if (pattern === undefined) {
      throw new Error(
        `Unknown capture ${capture[2]}; expected one of ${Object.keys(CAPTURES).join(', ')}`,
      );
    }
    return { kind: 'capture', line, variable: capture[1], pattern };
  }
  const timeout = /^#! timeout (\d+)$/u.exec(line);
  if (timeout !== null) {
    return { kind: 'timeout', line, milliseconds: Number(timeout[1]) * 1000 };
  }
  throw new Error(`Unknown directive: ${line}`);
}

export function defaultTimeout(command) {
  return /^blackbox capsule up\b/u.test(command) ? UP_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

/** Collapses every run of 2+ spaces to exactly two and drops trailing spaces. */
export function normalizeWhitespace(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/ {2,}/gu, '  ').replace(/[ \t]+$/u, ''))
    .join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const CAPSULE = String.raw`[a-z]+-[a-z]+-[a-z]+-\d{12}`;
const URL = String.raw`https?://(?:127\.0\.0\.1|localhost|\[::1\]):\d+[^\s"'<>]*`;
const TIME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})`;
const TRACE = String.raw`\b[0-9a-f]{32}\b`;
const ACTIVITY = String.raw`\b[0-9a-f]{8}(?:-[0-9a-f]{1,4}(?:-[0-9a-f]{1,4}(?:-[0-9a-f]{1,4}(?:-[0-9a-f]{1,12})?)?)?)?\b`;
const SPANS = String.raw`\b\d+(?= spans\b)`;
// A capsule's total trace count includes readiness-probe traffic and varies
// between runs; an activity's `<n> traces` does not and stays literal.
const CAPSULE_TRACES = String.raw`(?<=· traces )\d+\b`;
const DURATION = String.raw`\b\d+(?:\.\d+)?(?:ms|s)\b`;

/**
 * Stateful normalizer for one journey: placeholders are numbered by first
 * appearance and stay consistent across every command of the journey. An
 * activity token is replaced only when it is a prefix of a known retained
 * activity ID, keyed by that full ID, so a short and a full form share one
 * placeholder and an unrelated hex word (for example deadbeef) survives.
 */
export function createNormalizer({ projectPaths = [], activityIds = [] } = {}) {
  const numbering = { CAPSULE: new Map(), ACT: new Map(), TRACE: new Map() };
  const placeholder = (kind, key) => {
    const map = numbering[kind];
    if (!map.has(key)) map.set(key, `<${kind}_${map.size + 1}>`);
    return map.get(key);
  };
  const paths = [...new Set(projectPaths)].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const alternatives = [
    ...(paths.length > 0 ? [`(?<project>${paths.join('|')})`] : []),
    `(?<url>${URL})`,
    `(?<time>${TIME})`,
    `(?<capsule>${CAPSULE})`,
    `(?<trace>${TRACE})`,
    `(?<activity>${ACTIVITY})`,
    `(?<spans>${SPANS})`,
    `(?<traces>${CAPSULE_TRACES})`,
    `(?<duration>${DURATION})`,
  ];
  const pattern = new RegExp(alternatives.join('|'), 'gu');
  const knownActivity = (token) => {
    const hex = token.replaceAll('-', '');
    return activityIds.find((id) => id.replaceAll('-', '').startsWith(hex)) ?? null;
  };
  return (text) =>
    text.replace(pattern, (match, ...rest) => {
      const groups = rest.at(-1);
      if (groups.project !== undefined) return '<PROJECT>';
      if (groups.url !== undefined) return '<URL>';
      if (groups.time !== undefined) return '<TIME>';
      if (groups.capsule !== undefined) return placeholder('CAPSULE', match);
      if (groups.trace !== undefined) return placeholder('TRACE', match);
      if (groups.activity !== undefined) {
        const id = knownActivity(match);
        return id === null ? match : placeholder('ACT', id);
      }
      if (groups.spans !== undefined || groups.traces !== undefined) return '<N>';
      return '<DUR>';
    });
}

/** Renders a transcript in golden format from executed items. */
export function renderTranscript(items) {
  const lines = [];
  for (const item of items) {
    if (item.kind === 'command') {
      lines.push(`$ ${item.command}`);
      const output = item.output.endsWith('\n') ? item.output.slice(0, -1) : item.output;
      if (item.output.length > 0) lines.push(...output.split('\n'));
    } else {
      lines.push(item.line);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
