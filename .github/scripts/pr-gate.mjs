#!/usr/bin/env node

// PR Gate aggregator (#106).
//
// One stable check, "PR Gate", evaluates only the explicitly required product
// lanes of the Continuous Integration workflow. Each lane keeps its own job
// and its own diagnosable result; this script only folds their `needs`
// results into one verdict and one summary.
//
// Rules:
// - Every required lane must report `success`. `failure`, `cancelled`,
//   `skipped`, any other value, or a missing entry fails the gate. A skipped
//   dependency can never pass the gate, so an unexpected `if:` on a lane or a
//   renamed job id is caught here rather than silently waved through.
// - Informational lanes (for example the legacy Harness E2E) are listed in the
//   summary when their check runs are visible, and never affect the verdict.
// - The verdict is computed from the `needs` context alone. GitHub API calls
//   only decorate the summary with job and artifact links; when they are not
//   available the summary says so and the verdict is unchanged.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Required lanes, keyed by the exact job id in `.github/workflows/ci.yml`.
 * `context` is the exact status-check context GitHub reports for that job and
 * is what the release ruleset requires today. Renaming either side must be
 * reconciled with the ruleset in the same change; `pr-gate.test.mjs` pins the
 * ids and names against the workflow file.
 */
export const REQUIRED_LANES = Object.freeze([
  Object.freeze({ id: 'consumer', context: 'Installed consumer / Packed-artifact Simulation' }),
  Object.freeze({ id: 'catalog-package', context: 'Packed catalog contract' }),
  Object.freeze({ id: 'build', context: 'Alpha Build and Typecheck' }),
  Object.freeze({ id: 'deps', context: 'Dependency Boundaries' }),
  Object.freeze({ id: 'lint', context: 'Package Lint / Collect Lint Reports' }),
  Object.freeze({ id: 'test', context: 'Package Tests and Coverage / Merge Coverage and Report' }),
]);

/** Exact job name of the aggregate; the future single required context. */
export const GATE_CONTEXT = 'PR Gate';

/**
 * Required contexts that live outside the Continuous Integration workflow and
 * therefore cannot be folded into the gate through `needs`. They stay
 * independent required checks on the ruleset.
 */
export const EXTERNAL_REQUIRED_CONTEXTS = Object.freeze(['Validate PR title']);

/**
 * Informational check names shown in the summary without affecting the
 * verdict. Promotion of any of these is a Project #5 decision, not a change
 * to this list alone.
 */
export const INFORMATIONAL_CONTEXTS = Object.freeze([
  'Harness E2E (testcontainers)',
  'Diagnostic proof only (never a release gate)',
]);

const VALID_NEEDS_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function normalizeNeedsResult(value) {
  if (typeof value !== 'string') {
    return 'missing';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '') {
    return 'missing';
  }
  return VALID_NEEDS_RESULTS.has(normalized) ? normalized : `invalid:${normalized}`;
}

/**
 * Evaluate the gate from a `needs` context object.
 *
 * @param {Record<string, { result?: string } | undefined> | null | undefined} needs
 * @param {{ requiredLanes?: readonly { id: string, context: string }[] }} [options]
 */
export function evaluateGate(needs, options = {}) {
  const requiredLanes = options.requiredLanes ?? REQUIRED_LANES;
  const lanes = requiredLanes.map((lane) => {
    const entry = needs && typeof needs === 'object' ? needs[lane.id] : undefined;
    const present = entry !== undefined && entry !== null && typeof entry === 'object';
    const result = present ? normalizeNeedsResult(entry.result) : 'missing';
    return {
      id: lane.id,
      context: lane.context,
      result,
      required: true,
      passed: result === 'success',
    };
  });

  const knownIds = new Set(requiredLanes.map((lane) => lane.id));
  const unexpected =
    needs && typeof needs === 'object'
      ? Object.keys(needs)
          .filter((id) => !knownIds.has(id))
          .sort()
      : [];

  const failed = lanes.filter((lane) => !lane.passed);
  return {
    verdict: failed.length === 0 && lanes.length > 0 ? 'success' : 'failure',
    lanes,
    failed: failed.map((lane) => ({ id: lane.id, context: lane.context, result: lane.result })),
    unexpected,
  };
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'blackbox-pr-gate',
  };
}

async function fetchJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    throw new Error(`${url} responded ${String(response.status)}`);
  }
  return response.json();
}

/**
 * Decorate lanes with job and artifact links from the GitHub API. Failures
 * are reported in `notes`, never thrown, so the verdict path stays pure.
 */
export async function decorateWithLinks(evaluation, context, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const notes = [];
  const jobs = new Map();
  const artifacts = [];
  const informational = [];

  if (!context.token) {
    notes.push('GITHUB_TOKEN was not available; job and artifact links were not resolved.');
    return { ...evaluation, jobs, artifacts, informational, notes };
  }
  const base = `${context.apiUrl}/repos/${context.repository}`;

  try {
    const payload = await fetchJson(
      `${base}/actions/runs/${context.runId}/jobs?per_page=100`,
      context.token,
      fetchImpl,
    );
    for (const job of payload.jobs ?? []) {
      jobs.set(job.name, { url: job.html_url, status: job.status, conclusion: job.conclusion });
    }
  } catch (error) {
    notes.push(`Job links were not resolved: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const payload = await fetchJson(
      `${base}/actions/runs/${context.runId}/artifacts?per_page=100`,
      context.token,
      fetchImpl,
    );
    for (const artifact of payload.artifacts ?? []) {
      artifacts.push({
        name: artifact.name,
        url: `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}/artifacts/${String(artifact.id)}`,
        sizeInBytes: artifact.size_in_bytes,
      });
    }
    artifacts.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    notes.push(
      `Artifact links were not resolved: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (context.headSha) {
    try {
      const payload = await fetchJson(
        `${base}/commits/${context.headSha}/check-runs?per_page=100`,
        context.token,
        fetchImpl,
      );
      for (const run of payload.check_runs ?? []) {
        if (INFORMATIONAL_CONTEXTS.includes(run.name)) {
          informational.push({
            context: run.name,
            status: run.status,
            conclusion: run.conclusion,
            url: run.html_url,
          });
        }
      }
      informational.sort((left, right) => left.context.localeCompare(right.context));
    } catch (error) {
      notes.push(
        `Informational check runs were not resolved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    notes.push('Head SHA was not available; informational check runs were not resolved.');
  }

  return { ...evaluation, jobs, artifacts, informational, notes };
}

function icon(result) {
  return result === 'success' ? 'pass' : 'FAIL';
}

export function renderSummary(report, context) {
  const lines = [];
  lines.push(`## ${GATE_CONTEXT}: ${report.verdict === 'success' ? 'pass' : 'FAIL'}`);
  lines.push('');
  lines.push(
    `Run [${String(context.runId)}](${context.serverUrl}/${context.repository}/actions/runs/${String(context.runId)}) attempt ${String(context.runAttempt)}` +
      (context.headSha ? `, head \`${context.headSha}\`` : ''),
  );
  lines.push('');
  lines.push('### Required lanes');
  lines.push('');
  lines.push('| Lane | Result | Job | Verdict |');
  lines.push('| --- | --- | --- | --- |');
  for (const lane of report.lanes) {
    const job = report.jobs?.get(lane.context);
    const link = job ? `[open](${job.url})` : 'link unavailable';
    lines.push(`| ${lane.context} | \`${lane.result}\` | ${link} | ${icon(lane.passed ? 'success' : 'failure')} |`);
  }
  if (report.unexpected.length > 0) {
    lines.push('');
    lines.push(
      `Unexpected \`needs\` entries ignored by the verdict: ${report.unexpected.map((id) => `\`${id}\``).join(', ')}.`,
    );
  }
  lines.push('');
  lines.push('### Independent required checks outside this workflow');
  lines.push('');
  for (const name of EXTERNAL_REQUIRED_CONTEXTS) {
    lines.push(`- ${name} (separate workflow; required by the ruleset, not folded into this gate)`);
  }
  lines.push('');
  lines.push('### Informational lanes (never affect the verdict)');
  lines.push('');
  if (report.informational && report.informational.length > 0) {
    for (const item of report.informational) {
      const state = item.conclusion ?? item.status ?? 'unknown';
      lines.push(`- [${item.context}](${item.url}): \`${state}\``);
    }
  } else {
    lines.push(`- ${INFORMATIONAL_CONTEXTS.join(', ')}: not resolved for this head`);
  }
  lines.push('');
  lines.push('### Retained artifacts and receipts');
  lines.push('');
  if (report.artifacts && report.artifacts.length > 0) {
    for (const artifact of report.artifacts) {
      lines.push(`- [${artifact.name}](${artifact.url}) (${String(artifact.sizeInBytes)} bytes)`);
    }
  } else {
    lines.push('- none resolved');
  }
  if (report.notes && report.notes.length > 0) {
    lines.push('');
    lines.push('### Notes');
    lines.push('');
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function buildReceipt(report, context) {
  return {
    schemaVersion: 1,
    gate: GATE_CONTEXT,
    verdict: report.verdict,
    generatedAt: context.now ?? new Date().toISOString(),
    repository: context.repository,
    runId: context.runId,
    runAttempt: context.runAttempt,
    headSha: context.headSha ?? null,
    requiredLanes: report.lanes.map((lane) => ({
      id: lane.id,
      context: lane.context,
      result: lane.result,
      passed: lane.passed,
      jobUrl: report.jobs?.get(lane.context)?.url ?? null,
    })),
    failed: report.failed,
    unexpectedNeeds: report.unexpected,
    externalRequiredContexts: [...EXTERNAL_REQUIRED_CONTEXTS],
    informational: report.informational ?? [],
    artifacts: report.artifacts ?? [],
    notes: report.notes ?? [],
  };
}

export function contextFromEnvironment(environment = process.env) {
  return {
    token: environment.GITHUB_TOKEN ?? '',
    apiUrl: environment.GITHUB_API_URL ?? 'https://api.github.com',
    serverUrl: environment.GITHUB_SERVER_URL ?? 'https://github.com',
    repository: environment.GITHUB_REPOSITORY ?? 'unknown/unknown',
    runId: environment.GITHUB_RUN_ID ?? 'local',
    runAttempt: environment.GITHUB_RUN_ATTEMPT ?? '1',
    headSha: environment.PR_GATE_HEAD_SHA || environment.GITHUB_SHA || '',
  };
}

export function parseNeeds(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

/**
 * CLI: `node pr-gate.mjs evaluate [--needs-file <path>] [--receipt <path>]`
 *
 * `needs` comes from `PR_GATE_NEEDS` (the `toJSON(needs)` of the gate job) or
 * from `--needs-file` for controlled proofs. Exit code 0 only on `success`.
 */
export async function main(argv, environment = process.env, dependencies = {}) {
  const [command, ...rest] = argv;
  if (command !== 'evaluate') {
    throw new Error(`Unknown command "${String(command)}". Use: evaluate`);
  }
  let needsFile = '';
  let receiptPath = environment.PR_GATE_RECEIPT || 'ci-evidence/pr-gate/receipt.json';
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--needs-file') {
      index += 1;
      needsFile = rest[index] ?? '';
    } else if (argument === '--receipt') {
      index += 1;
      receiptPath = rest[index] ?? receiptPath;
    } else {
      throw new Error(`Unknown argument "${argument}"`);
    }
  }
  const needsText = needsFile ? readFileSync(needsFile, 'utf8') : environment.PR_GATE_NEEDS;
  const needs = parseNeeds(needsText);
  const context = contextFromEnvironment(environment);
  const evaluation = evaluateGate(needs);
  const report = await decorateWithLinks(evaluation, context, dependencies);
  const summary = renderSummary(report, context);
  const receipt = buildReceipt(report, context);

  mkdirSync(path.dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(path.join(path.dirname(receiptPath), 'summary.md'), summary);
  if (environment.GITHUB_STEP_SUMMARY) {
    writeFileSync(environment.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }
  if (environment.GITHUB_OUTPUT) {
    writeFileSync(environment.GITHUB_OUTPUT, `verdict=${report.verdict}\n`, { flag: 'a' });
  }
  const stdout = dependencies.stdout ?? process.stdout;
  stdout.write(summary);
  return report.verdict === 'success' ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}
