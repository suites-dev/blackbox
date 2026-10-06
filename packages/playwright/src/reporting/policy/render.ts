import { reportText } from '../text.js';
import type { BaselineComparison } from './compare.js';
import type { PolicyManifest } from './manifest.js';

/** Long selections stay readable; the written manifest keeps every difference. */
const maxPrintedDifferences = 50;

function show(value: unknown): string {
  return JSON.stringify(value);
}

function fields(record: object): string {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${show(value)}`)
    .join(' ');
}

function testsLine(manifest: PolicyManifest, selected: number): string {
  const own = Object.keys(manifest.policy.tests ?? {}).length;
  return own === 0
    ? `tests: ${selected} selected; all use their project's retries and timeout`
    : `tests: ${selected} selected; ${own} with their own retries or timeout`;
}

function baselineLines(comparison: BaselineComparison): string[] {
  switch (comparison.kind) {
    case 'unconfigured':
      return ['baseline: not configured; this policy is printed, not verified'];
    case 'match':
      return [`baseline: ${comparison.baseline} (matches)`];
    case 'invalid':
      return [`baseline: ${comparison.baseline} is unusable: ${comparison.reason}`];
    case 'drift': {
      const shown = comparison.differences.slice(0, maxPrintedDifferences);
      const hidden = comparison.differences.length - shown.length;
      return [
        `baseline: ${comparison.baseline} differs (${comparison.differences.length} difference(s)):`,
        ...shown.map((difference) => `  ${difference}`),
        ...(hidden > 0 ? [`  … ${hidden} more; see the written policy manifest`] : []),
      ];
    }
  }
}

/** The runner-policy block printed at the start of every run and attached to every test. */
export function policyReport(
  manifest: PolicyManifest,
  comparison: BaselineComparison,
  selectedTests: number,
): string {
  const { projects, selection, sandboxCleanupTimeoutMs, tests, ...run } = manifest.policy;
  const lines = [
    'Blackbox runner policy (fields at their default are omitted)',
    `  run: ${fields(run)}`,
    `  selection: ${selection === undefined ? 'none on the command line' : fields(selection)}`,
    ...Object.entries(projects).map(
      ([name, project]) =>
        `  project ${show(name)}: ${Object.keys(project).length === 0 ? 'defaults' : fields(project)}`,
    ),
    ...(sandboxCleanupTimeoutMs === undefined
      ? []
      : [`  blackbox: sandboxCleanupTimeoutMs=${sandboxCleanupTimeoutMs}`]),
    `  ${testsLine(manifest, selectedTests)}`,
    ...Object.entries(tests ?? {}).map(([name, own]) => `    ${name}: ${fields(own)}`),
    `  argv: ${show(manifest.argv.slice(2))}`,
    ...baselineLines(comparison).map((line) => `  ${line}`),
  ];
  return lines.map(reportText).join('\n');
}

/** Null when the run may keep its own status; otherwise why verification failed. */
export function verificationFailure(comparison: BaselineComparison): string | null {
  switch (comparison.kind) {
    case 'unconfigured':
    case 'match':
      return null;
    case 'invalid':
      return reportText(
        `Blackbox runner policy verification failed: baseline ${comparison.baseline} is unusable: ${comparison.reason}`,
      );
    case 'drift':
      return reportText(
        `Blackbox runner policy verification failed: ${comparison.differences.length} difference(s) ` +
          `from baseline ${comparison.baseline}. Change the baseline in a reviewed PR to accept them.`,
      );
  }
}
