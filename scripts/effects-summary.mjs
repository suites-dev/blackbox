// Summarizes the effects of each test attempt in a Playwright JSON results file as one effects
// record. It reads only the `blackbox-effects` and `blackbox-attempt` attachments the Playwright
// adapter already writes; it runs nothing and changes no file. Run it with
// `node scripts/effects-summary-run.mjs <results.json> [--json]` after `pnpm build`.
//
// A retried test has one result, and so one record, per attempt: each attempt ran in its own
// sandbox, and an earlier failed attempt is evidence that a later pass must not hide.
import { existsSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadEffects(root) {
  const entry = join(root, 'packages', 'effects', 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new Error('packages/effects is not built: run `pnpm build` first');
  }
  return import(pathToFileURL(entry).href);
}

/** The real path of `file`, only when it lies inside `root` after symbolic links are followed. */
async function insidePath(root, file) {
  const base = await realpath(root);
  const lexical = resolve(base, file);
  // The root may be spelled through a link (a temporary directory on macOS): accept either spelling.
  if (!lexical.startsWith(base + sep) && !lexical.startsWith(resolve(root) + sep)) {
    throw new Error(`${file} is outside ${base}`);
  }
  const real = await realpath(lexical);
  if (!real.startsWith(base + sep)) {
    throw new Error(`${file} resolves outside ${base}`);
  }
  return real;
}

async function bodyOf(attachment, root) {
  if (typeof attachment.body === 'string') {
    return Buffer.from(attachment.body, 'base64').toString('utf8');
  }
  if (typeof attachment.path === 'string') {
    return readFile(await insidePath(root, attachment.path), 'utf8');
  }
  throw new Error(`Attachment ${attachment.name} has neither a body nor a path`);
}

function* testResults(suites, trail = []) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          yield { title: [...trail, suite.title, spec.title].filter(Boolean).join(' › '), result };
        }
      }
    }
    yield* testResults(suite.suites ?? [], [...trail, suite.title].filter(Boolean));
  }
}

/** What the adapter says it left out of one attachment: omitted evidence and cut strings. */
function lossesOf(document) {
  const evidence = document.evidence ?? {};
  const omitted = Object.entries(evidence.omitted ?? {})
    .filter(([, count]) => typeof count === 'number' && count > 0)
    .map(([name]) => name);
  const truncated = (document.display ?? {}).truncatedStrings;
  return [
    ...(omitted.length > 0 ? [`omitted ${omitted.join(', ')}`] : []),
    ...(typeof truncated === 'number' && truncated > 0 ? ['truncated strings'] : []),
  ];
}

async function evidenceOf(result, root) {
  const graphs = [];
  const unavailable = [];
  const losses = [];
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'blackbox-effects') continue;
    const document = JSON.parse(await bodyOf(attachment, root));
    const evidence = document.evidence ?? {};
    losses.push(...lossesOf(document));
    if (evidence.kind === 'admitted' && evidence.projection !== undefined) {
      graphs.push(evidence.projection);
    } else {
      unavailable.push(String(evidence.kind ?? 'missing'));
    }
  }
  return { graphs, unavailable, losses };
}

const COVERAGE_RANK = { complete: 2, partial: 1, unknown: 0 };

/**
 * One graph out of every scope a test read. Scopes can overlap (a later assertion's scope holds
 * the earlier stimuli too), so an effect is counted once by its identity, never once per scope.
 */
function mergeGraphs(graphs) {
  const effects = new Map();
  for (const graph of graphs) {
    for (const effect of graph.effects) {
      if (!effects.has(effect.id)) effects.set(effect.id, effect);
    }
  }
  const coverage = graphs
    .map((graph) => graph.quality.coverage)
    .reduce((worst, next) => (COVERAGE_RANK[next] < COVERAGE_RANK[worst] ? next : worst));
  return {
    schemaVersion: graphs[0].schemaVersion,
    scope: {
      id: graphs.map((graph) => graph.scope.id).join('+'),
      closed: graphs.every((graph) => graph.scope.closed),
    },
    quality: {
      coverage,
      orderCoverage: 'unknown',
      reasons: [...new Set(graphs.flatMap((graph) => graph.quality.reasons))],
      attestation: 'none',
    },
    effects: [...effects.values()],
    relations: [],
  };
}

async function attemptId(result, fallback, root) {
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'blackbox-attempt') continue;
    const document = JSON.parse(await bodyOf(attachment, root));
    const identity = document.identity ?? {};
    if (typeof identity.sandboxId === 'string' && identity.sandboxId.length > 0) {
      return identity.sandboxId;
    }
  }
  return fallback;
}

/**
 * `root` is the directory the results file must lie in (default: the current directory); the
 * attachments it names must lie in the results file's own directory. Symbolic links are followed
 * before that check.
 */
export async function summarize(resultsPath, { root = process.cwd(), effects = null } = {}) {
  const { createEffectsRecord, createEffectsRecordFromGraph } =
    effects ?? (await loadEffects(ROOT));
  const resultsFile = await insidePath(root, resultsPath);
  const document = JSON.parse(await readFile(resultsFile, 'utf8'));
  const attachmentRoot = dirname(resultsFile);
  const summaries = [];
  for (const { title, result } of testResults(document.suites ?? [])) {
    const { graphs, unavailable, losses } = await evidenceOf(result, attachmentRoot);
    const source = {
      kind: 'playwright-attempt',
      id: await attemptId(result, title, attachmentRoot),
    };
    const merged =
      graphs.length === 0
        ? createEffectsRecord({ source, completeness: { status: 'complete' }, effects: [] })
        : createEffectsRecordFromGraph({ source, graph: mergeGraphs(graphs) });
    // A test with no effects attachment (it failed before an assertion, or made none) has no
    // evidence at all; that is "unknown", never a complete record with no effects.
    const noEvidence =
      graphs.length === 0 && unavailable.length === 0 ? ['no effects evidence'] : [];
    const incomplete = [
      ...(merged.completeness.status === 'incomplete' ? [merged.completeness.reason] : []),
      ...unavailable.map((kind) => `evidence ${kind}`),
      ...losses,
      ...noEvidence,
    ];
    const record = createEffectsRecord({
      source,
      completeness:
        incomplete.length > 0
          ? { status: 'incomplete', reason: [...new Set(incomplete)].join('; ') }
          : { status: 'complete' },
      effects: merged.effects,
    });
    summaries.push({ title, retry: result.retry ?? 0, status: result.status, record });
  }
  return summaries;
}

/** The outcome is shown only when it says something, so a change in it is never hidden. */
function line(effect) {
  const outcome = effect.outcome === 'unknown' ? '' : `:${effect.outcome}`;
  return `${effect.kind}:${effect.operation}:${effect.target}${outcome}×${String(effect.count)}`;
}

export function format(summaries) {
  return summaries
    .map(({ title, retry, status, record }) => {
      const state =
        record.completeness.status === 'incomplete'
          ? `incomplete (${record.completeness.reason})`
          : record.completeness.status;
      const effects =
        record.effects.length === 0 ? 'no effects observed' : record.effects.map(line).join(', ');
      const attempt = retry > 0 ? ` (retry ${String(retry)})` : '';
      return `${status.padEnd(7)} ${title}${attempt}\n        ${state}\n        ${effects}`;
    })
    .join('\n');
}
