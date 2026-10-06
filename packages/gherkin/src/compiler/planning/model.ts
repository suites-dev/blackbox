import type { CatalogEntryKind, CatalogEntrySummary } from '@suites/blackbox-catalog';

import type { SandboxEnvironmentSpec } from '../../runtime/environment.js';
import type { StepArgument, StepDefinition, StepLibrary } from '../../runtime/step-types.js';
import type { SourceLocation } from './diagnostics.js';

/** A Sandbox profile from protected project configuration. It names variables, never values. */
export interface SandboxProfile {
  readonly environment: SandboxEnvironmentSpec;
}

/** Everything a feature is compiled against. None of it comes from the feature text. */
export interface CompileContext {
  readonly catalog: readonly CatalogEntrySummary[];
  readonly sandboxProfiles: Readonly<Record<string, SandboxProfile>>;
  readonly library: StepLibrary;
}

export interface FeatureSelection {
  readonly kind: CatalogEntryKind;
  readonly id: string;
  readonly sandbox: string;
}

export interface PlannedStep extends SourceLocation {
  readonly keyword: string;
  readonly text: string;
  readonly argument: StepArgument;
  readonly definition: StepDefinition;
}

export interface PlannedBackground extends SourceLocation {
  readonly steps: readonly PlannedStep[];
}

export interface PlannedScenario extends SourceLocation {
  /** Stable within a compile: `<feature>:<line>`, plus `:<row line>` for an Examples row. */
  readonly id: string;
  readonly title: string;
  readonly exampleLine: number | null;
  readonly requirements: readonly string[];
  readonly steps: readonly PlannedStep[];
}

export interface PlannedRule extends SourceLocation {
  readonly title: string;
  readonly background: PlannedBackground | null;
  readonly scenarios: readonly PlannedScenario[];
}

export interface FeaturePlan extends SourceLocation {
  /** The feature path relative to the compile root, with `/` separators. */
  readonly file: string;
  readonly title: string;
  readonly description: string;
  readonly selection: FeatureSelection;
  readonly environment: SandboxEnvironmentSpec;
  readonly background: PlannedBackground | null;
  readonly scenarios: readonly PlannedScenario[];
  readonly rules: readonly PlannedRule[];
}
