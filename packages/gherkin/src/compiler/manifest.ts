import { createHash } from 'node:crypto';

import type { Capability, StepLibraryIdentity } from '../runtime/library.js';
import type {
  FeaturePlan,
  FeatureSelection,
  PlannedBackground,
  PlannedScenario,
  PlannedStep,
} from './planning/model.js';

export const MANIFEST_FILE = 'compile-manifest.json';
export const COMPILER_NAME = '@suites/blackbox-gherkin';

/** A barrier step's deadline, written in the feature text (runner policy, hard rule 5). */
export interface BarrierDeadline {
  /** The barrier step's `.feature` position; a Background barrier counts for every scenario it runs in. */
  readonly line: number;
  readonly column: number;
  readonly seconds: number;
}

export interface CompiledScenario {
  readonly id: string;
  readonly feature: string;
  readonly line: number;
  readonly column: number;
  /** The Examples row this test was compiled from, or null for a plain scenario. */
  readonly exampleLine: number | null;
  /** Describe titles below the sandbox group, ending with the test title. */
  readonly titlePath: readonly string[];
  readonly generated: string;
  readonly selection: FeatureSelection;
  /** Traceability only; never part of any verdict. */
  readonly requirements: readonly string[];
  /** Every barrier deadline this scenario runs, Background steps first. */
  readonly barrierDeadlines: readonly BarrierDeadline[];
}

export interface CompiledFeature {
  readonly feature: string;
  readonly featureHash: string;
  readonly title: string;
  /** Free-form Feature description, kept as documentation and never executed. */
  readonly description: string;
  readonly selection: FeatureSelection;
  readonly generated: string;
  readonly generatedHash: string;
}

export interface CompileManifest {
  readonly schemaVersion: 1;
  readonly compiler: typeof COMPILER_NAME;
  readonly library: StepLibraryIdentity;
  readonly capabilities: readonly Capability[];
  readonly features: readonly CompiledFeature[];
  readonly scenarios: readonly CompiledScenario[];
}

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

function barrierDeadlines(steps: readonly PlannedStep[]): readonly BarrierDeadline[] {
  return steps.flatMap((step) => {
    const index = step.definition.deadlineParameter;
    if (index === null) {
      return [];
    }
    const seconds = step.parameters[index];
    if (typeof seconds !== 'number') {
      throw new TypeError(`Step ${JSON.stringify(step.definition.expression)} parameter ${index} is not a deadline`);
    }
    return [{ line: step.line, column: step.column, seconds }];
  });
}

const stepsOf = (background: PlannedBackground | null): readonly PlannedStep[] =>
  background === null ? [] : background.steps;

export function scenarioRecords(plan: FeaturePlan, generated: string): readonly CompiledScenario[] {
  const record = (
    scenario: PlannedScenario,
    scope: { readonly parents: readonly string[]; readonly background: readonly PlannedStep[] },
  ): CompiledScenario => ({
    id: scenario.id,
    feature: plan.file,
    line: scenario.line,
    column: scenario.column,
    exampleLine: scenario.exampleLine,
    titlePath: [plan.title, ...scope.parents, scenario.title],
    generated,
    selection: plan.selection,
    requirements: scenario.requirements,
    barrierDeadlines: barrierDeadlines([...scope.background, ...scenario.steps]),
  });
  const featureBackground = stepsOf(plan.background);
  return [
    ...plan.scenarios.map((scenario) => record(scenario, { parents: [], background: featureBackground })),
    ...plan.rules.flatMap((rule) =>
      rule.scenarios.map((scenario) =>
        record(scenario, {
          parents: [rule.title],
          background: [...featureBackground, ...stepsOf(rule.background)],
        }),
      ),
    ),
  ];
}
