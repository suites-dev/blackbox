import type { SourceLocation } from '../feature/diagnostics.js';
import type { ExampleRow, StepArgument } from '../feature/model.js';

// The outline of a feature: plain data a suite emitter or a drift check can
// read without parsing Gherkin. Every position is a `.feature` line and column.

export interface OutlineStep extends SourceLocation {
  /** The keyword as written: `Given`, `When`, `Then`, `And`, `But` or `*`. */
  readonly keyword: string;
  /** The step text; in an Examples row, with the row's values in place of its placeholders. */
  readonly text: string;
  /** The expression of the one sentence the text matches, or null when it matches none or several. */
  readonly sentence: string | null;
  /** The matched sentence's parameter values, in order, as text; empty when `sentence` is null. */
  readonly values: readonly string[];
  readonly argument: StepArgument;
}

export interface OutlineBackground extends SourceLocation {
  readonly steps: readonly OutlineStep[];
}

export interface OutlineScenario extends SourceLocation {
  /** The scenario name; in an Examples row, with the row's values in place of its placeholders. */
  readonly title: string;
  /** Tags written on the scenario, then those on its Examples block. */
  readonly tags: readonly string[];
  /** For a Scenario Outline, the Examples row this scenario was expanded from. */
  readonly example: ExampleRow | null;
  /** The scenario's own steps; Background steps are listed with their Background. */
  readonly steps: readonly OutlineStep[];
}

export interface OutlineRule extends SourceLocation {
  readonly title: string;
  readonly tags: readonly string[];
  readonly background: OutlineBackground | null;
  readonly scenarios: readonly OutlineScenario[];
}

export interface FeatureOutline extends SourceLocation {
  /** The feature path relative to the project directory, with `/` separators. */
  readonly file: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly background: OutlineBackground | null;
  readonly scenarios: readonly OutlineScenario[];
  readonly rules: readonly OutlineRule[];
}
