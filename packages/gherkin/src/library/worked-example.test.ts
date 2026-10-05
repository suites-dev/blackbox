import { readFile } from 'node:fs/promises';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { FeaturePlan, PlannedStep } from '../compiler/planning/model.js';
import { planFeature } from '../compiler/planning/plan.js';
import { testCatalog } from '../compiler/testing/context.js';
import { library } from './index.js';
import { scenarioAt, runLibraryStep } from './testing/step-harness.js';
import { useStubSystems } from './testing/stub-lifecycle.js';
import type { StubMode } from './testing/stub-system.js';

// Requirement (task 2.3 acceptance): the library is qualified with spike E's
// no-row negative control. The report's worked example (section 6.1, without
// effects rows, plus a polling barrier) compiles against the real library and
// runs scenario by scenario, each against a fresh stub: every scenario is
// supported by the correct stub, and the no-row stub, which answers 201 but
// never persists the row, turns exactly the scenarios that depend on the row
// not supported, at the claim that notices.

const system = useStubSystems(beforeAll, afterEach);
const FEATURE = new URL('test-fixtures/subscription-intake.feature', import.meta.url);

async function plan(): Promise<FeaturePlan> {
  const source = await readFile(FEATURE, 'utf8');
  return planFeature(source, 'features/subscription-intake.feature', {
    catalog: testCatalog,
    sandboxProfiles: { default: { environment: {} } },
    library,
  });
}

function scenarios(feature: FeaturePlan): readonly { title: string; steps: readonly PlannedStep[] }[] {
  const background = feature.background === null ? [] : feature.background.steps;
  return [
    ...feature.scenarios.map((scenario) => ({ title: scenario.title, steps: [...background, ...scenario.steps] })),
    ...feature.rules.flatMap((rule) =>
      rule.scenarios.map((scenario) => ({
        title: scenario.title,
        steps: [...background, ...(rule.background === null ? [] : rule.background.steps), ...scenario.steps],
      })),
    ),
  ];
}

/** Runs every scenario on its own stub; a scenario is not supported at its first failing step. */
async function verdicts(mode: StubMode): Promise<Readonly<Record<string, string>>> {
  const results: Record<string, string> = {};
  for (const scenario of scenarios(await plan())) {
    const attempt = scenarioAt((await system(mode)).url);
    results[scenario.title] = 'supported';
    for (const step of scenario.steps) {
      const site = { feature: FEATURE, line: step.line, column: step.column, keyword: step.keyword };
      const failed = await runLibraryStep(attempt.fixtures, site, step.text, step.argument).then(
        () => false,
        () => true,
      );
      if (failed) {
        results[scenario.title] = `not supported at line ${step.line}: ${step.keyword} ${step.text}`;
        break;
      }
    }
  }
  return results;
}

const ELIGIBLE = 'Scenario: an eligible user receives an active subscription';
const GHOST = 'Scenario: an unknown user is rejected without side effects [user=ghost-user, method=pm_ghost]';
const MALLORY = 'Scenario: an unknown user is rejected without side effects [user=mallory, method=pm_mallory_1]';
const LOCAL = 'Scenario: a local-only user activates without ordering';
const REPEATED = 'Scenario: a repeated request does not repeat downstream effects';
const CONCURRENT = 'Scenario: concurrent requests create exactly one subscription';

describe('worked example against the library', () => {
  it('compiles every step against the shared library', async () => {
    expect(scenarios(await plan()).map((scenario) => scenario.title)).toEqual([
      ELIGIBLE,
      GHOST,
      MALLORY,
      LOCAL,
      REPEATED,
      CONCURRENT,
    ]);
  });

  it('is supported by the correct stub', async () => {
    expect(await verdicts('correct')).toEqual({
      [ELIGIBLE]: 'supported',
      [GHOST]: 'supported',
      [MALLORY]: 'supported',
      [LOCAL]: 'supported',
      [REPEATED]: 'supported',
      [CONCURRENT]: 'supported',
    });
  });

  it('turns the scenarios that need the row not supported under no-row', async () => {
    expect(await verdicts('no-row')).toEqual({
      [ELIGIBLE]:
        'not supported at line 29: And the state at "/fixture/state" as "fixture-control" has "/subscriptions" equal to:',
      [GHOST]: 'supported',
      [MALLORY]: 'supported',
      [LOCAL]: 'supported',
      [REPEATED]: 'not supported at line 85: And the response status is 409',
      [CONCURRENT]: 'not supported at line 95: And the response statuses are "201, 409"',
    });
  });
});
