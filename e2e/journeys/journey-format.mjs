// Golden journey format, normalization and comparison.
//
//   $ <cmd>                       compared command (stdout and stderr combined)
//   #! capture <VAR> <extractor>  set VAR from the previous command's RAW output
//   #! timeout <seconds>          timeout for the next command
//   #! volatile run-block         in the next command's (a provisional `blackbox
//                                 capsule run`) output, replace the Blackbox block,
//                                 `activity …` through `→ …`, with <VOLATILE>
//   #! wait <seconds> "<text>" <cmd>
//                                 rerun <cmd> (blackbox capsule show/ls only) every 500 ms,
//                                 output not compared, until its raw output
//                                 contains <text> literally; fail at the timeout
//   anything else                 expected output of the preceding command
//
// Span trees in show output are compared in canonical sibling order (see
// journey-trees.mjs): depth and parent are asserted, sibling order is not.

/**
 * The only captures a golden can name. Patterns are fixed here, never built
 * from golden text, and each takes its first group from the first matching line.
 */
export const CAPTURES = Object.freeze({
  'capsule-up': /^capsule (\S+) is up/mu,
  activity: /^activity ([0-9a-f-]+) · /mu,
  'current-row': /^\* (\S+) /mu,
  'single-token': /^(\S+)$/mu,
  'show-trace': /^→ blackbox capsule show ([0-9a-f]{32}) /mu,
});

export const WAIT_INTERVAL_MS = 500;

/**
 * Only one read-only inspection command may be polled: `blackbox capsule show`
 * or `blackbox capsule ls`, with plain arguments. Shell operators, quotes and
 * substitutions are refused, so a wait can never chain a second command.
 */
const WAITABLE = /^blackbox capsule (?:show|ls)(?: [\w$.:=@/-]+)*$/u;

/**
 * `#! wait <seconds> "<text>" <cmd>`. The text is a plain substring (it may
 * not contain `"`); a /…/ text is refused so no directive ever takes a regex.
 */
function parseWait(line) {
  const wait = /^#! wait (\d+) "([^"]+)" (.+)$/u.exec(line);
  if (wait === null) {
    throw new Error(`Invalid wait directive: ${line}`);
  }
  const [, seconds, text, command] = wait;
  if (/^\/.*\/[a-z]*$/u.test(text)) {
    throw new Error(`wait takes literal text, not a regex: ${line}`);
  }
  if (!WAITABLE.test(command)) {
    throw new Error(`wait may only poll blackbox capsule show or blackbox capsule ls: ${line}`);
  }
  return { kind: 'wait', line, milliseconds: Number(seconds) * 1000, text, command };
}

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
  if (line.startsWith('#! wait ')) {
    return parseWait(line);
  }
  if (line.startsWith('#! volatile')) {
    // Fixed text: no argument, no pattern.
    if (line !== '#! volatile run-block') {
      throw new Error(`volatile takes exactly "run-block": ${line}`);
    }
    return { kind: 'volatile', line };
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

/**
 * Collapses every run of 2+ spaces to exactly two and drops trailing spaces.
 * A run directly before a tree glyph (│ ├ └) is kept: it is a span tree's
 * indentation, and collapsing it would hide how deep a span sits.
 */
export function normalizeWhitespace(text) {
  return (
    text
      .split('\n')
      // A run is matched whole (never followed by another space), so it cannot
      // shed one space to slip past the glyph check.
      .map((line) => line.replace(/ {2,}(?![ │├└])/gu, '  ').replace(/[ \t]+$/u, ''))
      .join('\n')
  );
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
const SPAN_ID = String.raw`\b[0-9a-f]{16}\b`;
// A capsule's total trace count includes readiness-probe traffic and varies
// between runs; an activity's `<n> traces` does not and stays literal.
const CAPSULE_TRACES = String.raw`(?<=· traces )\d+\b`;
// So does the number of startup traces the timeline groups before the first activity.
const STARTUP_TRACES = String.raw`\b\d+(?= traces before the first activity\b)`;
const DURATION = String.raw`\b\d+(?:\.\d+)?(?:ms|s)\b`;

/**
 * Stateful normalizer for one journey: placeholders are numbered by first
 * appearance and stay consistent across every command of the journey. An
 * activity token is replaced only when it is a prefix of a known retained
 * activity ID, keyed by that full ID, so a short and a full form share one
 * placeholder and an unrelated hex word (for example deadbeef) survives. A
 * trace's 8-hex short form is replaced the same way, keyed by the full
 * retained trace ID. Every secret value becomes <SECRET>.
 */
export function createNormalizer({
  projectPaths = [],
  activityIds = [],
  traceIds = [],
  secrets = [],
} = {}) {
  const numbering = { CAPSULE: new Map(), ACT: new Map(), TRACE: new Map(), SPAN: new Map() };
  const placeholder = (kind, key) => {
    const map = numbering[kind];
    if (!map.has(key)) map.set(key, `<${kind}_${map.size + 1}>`);
    return map.get(key);
  };
  const paths = [...new Set(projectPaths)].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const hidden = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const alternatives = [
    ...(hidden.length > 0 ? [`(?<secret>${hidden.join('|')})`] : []),
    ...(paths.length > 0 ? [`(?<project>${paths.join('|')})`] : []),
    `(?<url>${URL})`,
    `(?<time>${TIME})`,
    `(?<capsule>${CAPSULE})`,
    `(?<trace>${TRACE})`,
    `(?<span>${SPAN_ID})`,
    // Also matches a trace's 8-hex short form; shortForm tells them apart.
    `(?<activity>${ACTIVITY})`,
    `(?<spans>${SPANS})`,
    `(?<traces>${CAPSULE_TRACES}|${STARTUP_TRACES})`,
    `(?<duration>${DURATION})`,
  ];
  const pattern = new RegExp(alternatives.join('|'), 'gu');
  const knownActivity = (token) => {
    const hex = token.replaceAll('-', '');
    return activityIds.find((id) => id.replaceAll('-', '').startsWith(hex)) ?? null;
  };
  const knownTrace = (token) => traceIds.find((id) => id.startsWith(token)) ?? null;
  const shortForm = (match) => {
    const activity = knownActivity(match);
    if (activity !== null) return placeholder('ACT', activity);
    const trace = knownTrace(match);
    return trace === null ? match : placeholder('TRACE', trace);
  };
  return (text) =>
    text.replace(pattern, (match, ...rest) => {
      const groups = rest.at(-1);
      if (groups.secret !== undefined) return '<SECRET>';
      if (groups.project !== undefined) return '<PROJECT>';
      if (groups.url !== undefined) return '<URL>';
      if (groups.time !== undefined) return '<TIME>';
      if (groups.capsule !== undefined) return placeholder('CAPSULE', match);
      if (groups.trace !== undefined) return placeholder('TRACE', match);
      if (groups.span !== undefined) return placeholder('SPAN', match);
      if (groups.activity !== undefined) return shortForm(match);
      if (groups.spans !== undefined || groups.traces !== undefined) return '<N>';
      return '<DUR>';
    });
}

export const VOLATILE = '<VOLATILE>';

/**
 * `#! volatile run-block`: replaces the Blackbox block of a `capsule run`
 * output (its first line starting `activity ` through its first line starting
 * `→ `, inclusive) with one <VOLATILE> line. Applied to NORMALIZED output, so
 * the child's own lines around the block are still compared. Refused when the
 * block is missing, not provisional, or would hide a secret.
 */
export function replaceRunBlock(command, output) {
  if (!/^blackbox capsule run /u.test(command)) {
    throw new Error(`volatile run-block applies only to blackbox capsule run: ${command}`);
  }
  const lines = output.split('\n');
  const first = lines.findIndex((line) => line.startsWith('activity '));
  const last =
    first < 0 ? -1 : lines.findIndex((line, index) => index > first && line.startsWith('→ '));
  if (first < 0 || last < 0) {
    throw new Error(`volatile run-block found no Blackbox block in the output of: ${command}`);
  }
  const block = lines.slice(first, last + 1);
  if (!block.some((line) => /^ {2}observed +.*· provisional \(capsule running\)$/u.test(line))) {
    throw new Error(`volatile run-block applies only while the capsule is provisional: ${command}`);
  }
  if (block.some((line) => line.includes('<SECRET>'))) {
    throw new Error(`a secret appeared in the Blackbox block of: ${command}`);
  }
  return [...lines.slice(0, first), VOLATILE, ...lines.slice(last + 1)].join('\n');
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
