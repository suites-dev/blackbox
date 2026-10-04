import { reportText } from '../text.js';
import type { BaselineComparison } from './compare.js';
import type { PolicyManifest, TestPolicy } from './manifest.js';

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

function distribution(tests: readonly TestPolicy[], field: keyof TestPolicy): string {
  const counts = new Map<number, number>();
  for (const test of tests) {
    counts.set(test[field], (counts.get(test[field]) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([value, count]) => `${value}×${count}`)
    .join(', ');
}

function testsLine(manifest: PolicyManifest): string {
  const tests = Object.values(manifest.policy.tests);
  if (tests.length === 0) {
    return 'tests: 0 selected';
  }
  return (
    `tests: ${tests.length} selected; ` +
    `retries ${distribution(tests, 'retries')}; timeout ${distribution(tests, 'timeout')}`
  );
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
export function policyReport(manifest: PolicyManifest, comparison: BaselineComparison): string {
  const { policy } = manifest;
  const lines = [
    'Blackbox runner policy',
    `  run: ${fields(policy.run)}`,
    ...Object.entries(policy.projects).map(
      ([name, project]) => `  project ${show(name)}: ${fields(project)}`,
    ),
    `  blackbox: ${fields(policy.blackbox)}`,
    `  ${testsLine(manifest)}`,
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
