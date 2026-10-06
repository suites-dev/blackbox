import type { Capability, StepDefinition, StepKind, StepResolution } from './step-types.js';

// The closed library as the compiler and the CLI see it. Step bodies
// and their fixtures stay in step-types.ts, which only the runtime and the
// library itself need.

export type { Capability, StepKind };

export interface StepLibraryIdentity {
  readonly name: string;
  readonly version: string;
  /** sha256 over every definition's expression, kind, argument, fixtures, capability and parameter roles. */
  readonly vocabularyHash: string;
}

/** A step as an author reads it: its definition without the body. */
export type StepVocabularyEntry = Omit<StepDefinition, 'run'>;

/** A closed, read-only step vocabulary. There is no registration API. */
export interface StepLibrary {
  readonly identity: StepLibraryIdentity;
  readonly capabilities: readonly Capability[];
  /** Every step in library order, for authors (`blackbox gherkin steps`). */
  readonly vocabulary: readonly StepVocabularyEntry[];
  resolve(text: string): StepResolution;
}
