import { DiagnosticSink, type ValidationError } from '../feature/diagnostics.js';
import type { FeatureBackground, FeatureScenario } from '../feature/model.js';
import { readFeature } from '../feature/read.js';
import { checkSelection, type SelectionContext } from './selection.js';
import { checkScenario, checkStep, type CheckedStep, type StepContext } from './steps.js';

export interface FeatureContext extends SelectionContext, StepContext {}

/**
 * Validates one `.feature` source: syntax, tags, selection, structure, every
 * step against the sentence list, and the scenario rules. Returns every error
 * in source order; empty when the feature is valid.
 */
export function validateFeature(
  source: string,
  file: string,
  context: FeatureContext,
): readonly ValidationError[] {
  const sink = new DiagnosticSink(file);
  const feature = readFeature(source, file, sink);
  if (feature === null) {
    return sink.errors;
  }
  checkSelection(feature.selection, feature, context, sink);
  const steps = (background: FeatureBackground | null): readonly CheckedStep[] =>
    background === null ? [] : background.steps.map((step) => checkStep(step, context, sink));
  const scenarios = (
    scenarioList: readonly FeatureScenario[],
    inherited: readonly CheckedStep[],
  ): void => {
    for (const scenario of scenarioList) {
      const own = scenario.steps.map((step) => checkStep(step, context, sink));
      checkScenario(scenario, [...inherited, ...own], sink);
    }
  };
  const outer = steps(feature.background);
  scenarios(feature.scenarios, outer);
  for (const rule of feature.rules) {
    scenarios(rule.scenarios, [...outer, ...steps(rule.background)]);
  }
  return sink.errors;
}
