// Summarizes the effects of each test in a Playwright JSON results file as one effects record per
// test. It reads only the `blackbox-effects` and `blackbox-attempt` attachments the Playwright
// adapter already writes; it runs nothing and changes no file. Run it with
// `node scripts/effects-summary-run.mjs <results.json> [--json]` after `pnpm build`.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadEffects(root) {
  const entry = join(root, 'packages', 'effects', 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new Error('packages/effects is not built: run `pnpm build` first');
  }
  return import(pathToFileURL(entry).href);
}

async function bodyOf(attachment) {
  if (typeof attachment.body === 'string') {
    return Buffer.from(attachment.body, 'base64').toString('utf8');
  }
  if (typeof attachment.path === 'string') {
    return readFile(attachment.path, 'utf8');
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

/** One graph per distinct scope: several assertions can read the same stimulus. */
async function evidenceOf(result) {
  const scopes = new Map();
  const unavailable = [];
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'blackbox-effects') continue;
    const document = JSON.parse(await bodyOf(attachment));
    const evidence = document.evidence ?? {};
    if (evidence.kind === 'admitted' && evidence.projection !== undefined) {
      scopes.set(evidence.projection.scope.id, evidence.projection);
    } else {
      unavailable.push(String(evidence.kind ?? 'missing'));
    }
  }
  return { graphs: [...scopes.values()], unavailable };
}

async function attemptId(result, fallback) {
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'blackbox-attempt') continue;
    const document = JSON.parse(await bodyOf(attachment));
    if (typeof document.sandboxId === 'string' && document.sandboxId.length > 0) {
      return document.sandboxId;
    }
  }
  return fallback;
}

export async function summarize(resultsPath, effects = null) {
  const { createEffectsRecord, createEffectsRecordFromGraph } =
    effects ?? (await loadEffects(ROOT));
  const document = JSON.parse(await readFile(resultsPath, 'utf8'));
  const summaries = [];
  for (const { title, result } of testResults(document.suites ?? [])) {
    const { graphs, unavailable } = await evidenceOf(result);
    const id = await attemptId(result, title);
    const source = { kind: 'playwright-attempt', id };
    const records = graphs.map((graph) => createEffectsRecordFromGraph({ source, graph }));
    const incomplete = [
      ...records.flatMap(({ completeness }) =>
        completeness.status === 'incomplete' ? [completeness.reason] : [],
      ),
      ...unavailable.map((kind) => `evidence ${kind}`),
    ];
    const record = createEffectsRecord({
      source,
      completeness:
        incomplete.length > 0
          ? { status: 'incomplete', reason: [...new Set(incomplete)].join('; ') }
          : { status: 'complete' },
      effects: records.flatMap((item) => item.effects),
    });
    summaries.push({ title, status: result.status, record });
  }
  return summaries;
}

function line(effect) {
  return `${effect.kind}:${effect.operation}:${effect.target}×${String(effect.count)}`;
}

export function format(summaries) {
  return summaries
    .map(({ title, status, record }) => {
      const state =
        record.completeness.status === 'incomplete'
          ? `incomplete (${record.completeness.reason})`
          : record.completeness.status;
      const effects =
        record.effects.length === 0 ? 'no effects observed' : record.effects.map(line).join(', ');
      return `${status.padEnd(7)} ${title}\n        ${state}\n        ${effects}`;
    })
    .join('\n');
}
