import { reportText } from '../text.js';
import type { AttemptView } from './types.js';

function line(value: string): string { return reportText(value); }

function coverageOf(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) { return 'unavailable'; }
  const coverage = value as Record<string, unknown>;
  const scope = typeof coverage.coverage === 'string' ? coverage.coverage : 'unknown';
  const closed = coverage.closed === true ? 'closed' : 'open';
  return `${scope}, ${closed}`;
}

/** One bounded, control-free summary of the retained physical attempt. */
export function renderAttemptText(view: AttemptView): string {
  const { attempt, verification, evidence } = view;
  const lines = [
    line(`Blackbox attempt ${attempt.retry + 1}: Playwright ${attempt.nativeStatus}; claims ${verification.status}; evidence ${evidence.status}; capture ${evidence.captureHealth.status}`),
    line(`Claims: ${verification.passed} passed, ${verification.failed} failed, ${verification.inconclusive} inconclusive, ${verification.interrupted} interrupted`),
  ];
  for (const execution of view.executions) {
    const output = execution.output === null ? 'unavailable' : 'captured';
    const initial = execution.initial === null ? 'unavailable' : 'captured';
    const final = execution.final === null ? 'unavailable' : 'captured';
    const latest = execution.effects.cuts.filter(({ purpose }) => purpose !== 'initial').at(-1);
    const observed = latest === undefined ? `${execution.effects.effects.length} in initial cut`
      : latest.status === 'captured' ? `${execution.effects.effects.length} initial, ${latest.effects.length} latest`
        : `${execution.effects.effects.length} initial, latest unavailable`;
    const coverage = latest !== undefined && latest.status === 'captured'
      ? latest.coverage : execution.effects.coverage;
    lines.push(line(`  ${execution.title}: output ${output}; state initial ${initial}, final ${final}; effects ${execution.effects.status} (${observed}, coverage ${coverageOf(coverage)})`));
    for (const claim of execution.steps.filter(({ kind, status }) => kind === 'claim' && status !== 'passed').slice(0, 5)) {
      lines.push(line(`    ${claim.status}: ${claim.title}`));
    }
  }
  for (const problem of evidence.problems.slice(0, 5)) { lines.push(line(`  evidence: ${problem}`)); }
  for (const error of attempt.errors.slice(0, 2)) { lines.push(line(`  Playwright: ${error}`)); }
  return lines.join('\n');
}
