import { createHash } from 'node:crypto';

import type { Capability, StepLibraryIdentity } from '../runtime/step-types.js';
import type { FeaturePlan, FeatureSelection, PlannedScenario } from './planning/model.js';

export const MANIFEST_FILE = 'compile-manifest.json';
export const COMPILER_NAME = '@suites/blackbox-gherkin';

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

export function scenarioRecords(plan: FeaturePlan, generated: string): readonly CompiledScenario[] {
  const record = (scenario: PlannedScenario, parents: readonly string[]): CompiledScenario => ({
    id: scenario.id,
    feature: plan.file,
    line: scenario.line,
    column: scenario.column,
    exampleLine: scenario.exampleLine,
    titlePath: [plan.title, ...parents, scenario.title],
    generated,
    selection: plan.selection,
    requirements: scenario.requirements,
  });
  return [
    ...plan.scenarios.map((scenario) => record(scenario, [])),
    ...plan.rules.flatMap((rule) => rule.scenarios.map((scenario) => record(scenario, [rule.title]))),
  ];
}
