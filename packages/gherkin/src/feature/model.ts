import type { SourceLocation } from './diagnostics.js';
import type { NodeTags } from './tags.js';

// A feature as validation and the outline read it: plain data, with every
// Scenario Outline expanded into one scenario per Examples row.

export interface DocStringArgument {
  readonly kind: 'doc-string';
  readonly content: string;
  readonly mediaType: string | null;
}

export interface DataTableArgument {
  readonly kind: 'data-table';
  readonly rows: readonly (readonly string[])[];
}

export interface NoArgument {
  readonly kind: 'none';
}

/** The doc string or data table written under a step. */
export type StepArgument = DocStringArgument | DataTableArgument | NoArgument;

export interface FeatureStep extends SourceLocation {
  /** The keyword as written, without surrounding space: `Given`, `And`, `*`. */
  readonly keyword: string;
  /** True for a Then step, and for an And or But that continues one. */
  readonly outcome: boolean;
  /** The step text; in an Examples row, with the row's values in place of its placeholders. */
  readonly text: string;
  readonly argument: StepArgument;
}

export interface FeatureBackground extends SourceLocation {
  readonly steps: readonly FeatureStep[];
}

export interface ExampleValue {
  /** The Examples header cell. */
  readonly name: string;
  readonly value: string;
}

/** The Examples row a scenario was expanded from, at the row's position. */
export interface ExampleRow extends SourceLocation {
  readonly values: readonly ExampleValue[];
}

export interface FeatureScenario extends SourceLocation {
  /** The scenario name; in an Examples row, with the row's values in place of its placeholders. */
  readonly title: string;
  /** Tags written on the scenario, then those on its Examples block. */
  readonly tags: readonly string[];
  readonly example: ExampleRow | null;
  /** The scenario's own steps, without those of any Background. */
  readonly steps: readonly FeatureStep[];
}

export interface FeatureRule extends SourceLocation {
  readonly title: string;
  readonly tags: readonly string[];
  readonly background: FeatureBackground | null;
  readonly scenarios: readonly FeatureScenario[];
}

export interface FeatureModel extends SourceLocation {
  /** The feature path relative to the project directory, with `/` separators. */
  readonly file: string;
  readonly title: string;
  readonly tags: readonly string[];
  /** The Feature's allowed tags with their positions, for selection. */
  readonly selection: NodeTags;
  readonly background: FeatureBackground | null;
  readonly scenarios: readonly FeatureScenario[];
  readonly rules: readonly FeatureRule[];
}
