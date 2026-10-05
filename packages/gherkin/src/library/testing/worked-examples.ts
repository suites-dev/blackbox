import { readFile } from 'node:fs/promises';

import type { FeaturePlan, PlannedStep } from '../../compiler/planning/model.js';
import { planFeature } from '../../compiler/planning/plan.js';
import { testCatalog } from '../../compiler/testing/context.js';
import { library } from '../index.js';
import { runLibraryStep, scenarioAt } from './step-harness.js';
import type { StubMode, StubSystem } from './stub-system.js';

// Compiles a worked-example feature from ../test-fixtures against the real
// library and runs it scenario by scenario, each on its own stub, the way a
// Blackbox attempt owns its Sandbox.

export function featureFixture(name: string): URL {
  return new URL(`../test-fixtures/${name}`, import.meta.url);
}

/** Plans the feature with the real library; an unresolved step is a FeatureCompileError. */
export async function planWorkedExample(feature: URL): Promise<FeaturePlan> {
  const source = await readFile(feature, 'utf8');
  const file = `features/${feature.pathname.split('/').at(-1) ?? ''}`;
  return planFeature(source, file, {
    catalog: testCatalog,
    sandboxProfiles: { default: { environment: {} } },
    library,
  });
}

export function scenarioSteps(feature: FeaturePlan): readonly { title: string; steps: readonly PlannedStep[] }[] {
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
export async function verdicts(
  feature: URL,
  system: (mode: StubMode) => Promise<StubSystem>,
  mode: StubMode,
): Promise<Readonly<Record<string, string>>> {
  const results: Record<string, string> = {};
  for (const scenario of scenarioSteps(await planWorkedExample(feature))) {
    const attempt = scenarioAt((await system(mode)).url);
    results[scenario.title] = 'supported';
    for (const step of scenario.steps) {
      const site = { feature, line: step.line, column: step.column, keyword: step.keyword };
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
