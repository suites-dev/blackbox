import type { ScenarioOutcome, VerifyResult } from './verify.js';

const VERDICTS = {
  supported: 'supported',
  'not-supported': 'not supported',
  'not-run': 'not run',
  duplicate: 'duplicate',
} as const satisfies Readonly<Record<ScenarioOutcome['verdict'], string>>;

/** One line per compiled scenario, with its requirement IDs, as the reporter prints verdicts. */
export function scenarioLine(scenario: ScenarioOutcome): string {
  const verdict =
    scenario.reasons.length === 0
      ? VERDICTS[scenario.verdict]
      : `${VERDICTS[scenario.verdict]} (${scenario.reasons.join(', ')})`;
  const requirements = scenario.requirements.length === 0 ? '-' : scenario.requirements.join(', ');
  return `${verdict} [${requirements}] ${scenario.feature}:${scenario.line} ${scenario.title}`;
}

/** The human-readable verify report; a failing report ends with every problem. */
export function renderVerify(result: VerifyResult): string {
  const supported = result.scenarios.filter((scenario) => scenario.verdict === 'supported').length;
  const summary = result.ok
    ? `verify: passed; ${supported} of ${result.scenarios.length} compiled scenarios supported, runner policy matches its baseline, features and step library unchanged since compile`
    : `verify: failed; ${supported} of ${result.scenarios.length} compiled scenarios supported, ${result.problems.length} other problem(s)`;
  return [
    ...result.scenarios.map(scenarioLine),
    ...result.problems.map((problem) => `error: ${problem}`),
    summary,
  ].join('\n');
}
