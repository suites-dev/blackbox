import type { RunManifest, ScenarioRecord } from '@suites/blackbox-playwright/reporter';

import type { CompiledScenario, CompileManifest } from '../compiler/manifest.js';

// The run manifest records Playwright tests, not compiled scenarios, so verify
// joins the two by title path. The generated file declares each scenario at
// [generated file, `<kind> "<id>"`, `sandbox "<profile>"`, Feature, Rule?,
// Scenario], below an optional project name; nothing else can produce that path.

/** One compiled scenario and what the run recorded for it. */
export interface ScenarioOutcome {
  readonly id: string;
  readonly feature: string;
  readonly line: number;
  readonly title: string;
  /** From the compile manifest; the verdict never reads them. */
  readonly requirements: readonly string[];
  readonly verdict: 'supported' | 'not-supported' | 'not-run' | 'duplicate';
  /** Why it is not supported, empty when it is. */
  readonly reasons: readonly string[];
}

export interface JoinedRun {
  readonly scenarios: readonly ScenarioOutcome[];
  readonly problems: readonly string[];
}

function declaredPath(scenario: CompiledScenario): readonly string[] {
  const { kind, id, sandbox } = scenario.selection;
  return [scenario.generated, `${kind} ${JSON.stringify(id)}`, `sandbox ${JSON.stringify(sandbox)}`, ...scenario.titlePath];
}

function declares(record: ScenarioRecord, path: readonly string[]): boolean {
  const recorded = record.titlePath.map((part) => part.replaceAll('\\', '/'));
  const project = recorded.length - path.length;
  return (project === 0 || project === 1) && path.every((part, index) => recorded[project + index] === part);
}

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

function outcome(scenario: CompiledScenario, records: readonly ScenarioRecord[]): ScenarioOutcome {
  const base = {
    id: scenario.id,
    feature: scenario.feature,
    line: scenario.line,
    title: scenario.titlePath.slice(1).join(' › '),
    requirements: scenario.requirements,
  };
  if (records.length === 0) {
    return { ...base, verdict: 'not-run', reasons: ['did not run'] };
  }
  if (records.length > 1) {
    return { ...base, verdict: 'duplicate', reasons: [`ran ${records.length} times; a scenario must run exactly once`] };
  }
  const [record] = records;
  return { ...base, verdict: record.verdict, reasons: record.reasons };
}

/** Joins every compiled scenario to its run record and reports what does not line up. */
export function joinRun(manifest: CompileManifest, run: RunManifest): JoinedRun {
  const claimed = new Set<ScenarioRecord>();
  const problems: string[] = [];
  const scenarios = manifest.scenarios.map((scenario) => {
    const path = declaredPath(scenario);
    const records = run.scenarios.filter((record) => declares(record, path));
    records.forEach((record) => claimed.add(record));
    const joined = outcome(scenario, records);
    if (records.length === 1 && !sameIds(records[0].requirements, scenario.requirements)) {
      problems.push(
        `requirement IDs of ${scenario.feature}:${scenario.line} differ between the compile manifest [${scenario.requirements.join(', ')}] and the run manifest [${records[0].requirements.join(', ')}]`,
      );
    }
    return joined;
  });
  for (const record of run.scenarios.filter((candidate) => !claimed.has(candidate))) {
    problems.push(`test "${record.titlePath.join(' › ')}" ran but was not compiled from an accepted feature`);
  }
  if (run.status !== 'passed') {
    problems.push(`the run status is "${run.status}", not "passed"`);
  }
  return { scenarios, problems };
}
