import type { SandboxCredentialSpec } from '../step-runtime/credentials.js';
import type { SandboxEnvironmentSpec } from '../step-runtime/environment.js';
import type { StepArgument } from '../step-runtime/step-types.js';

// Plain data that describes a feature and a committed suite file. The command
// plugin reads both (the feature with the Gherkin parser, the suite with a
// TypeScript parser) and passes them in; nothing here parses either language.

export type { StepArgument };

/** A converted parameter value: {int} is a number, {string} and {word} are strings. */
export type StepValue = string | number;

/** A Gherkin step as written: its keyword, its text and its doc string or data table. */
export interface FeatureStep {
  readonly keyword: string;
  readonly text: string;
  readonly argument: StepArgument;
  readonly line: number;
}

/** A scenario with its steps in run order, Background steps first. */
export interface FeatureScenario {
  readonly title: string;
  readonly line: number;
  readonly steps: readonly FeatureStep[];
}

/** The feature's Sandbox profile: environment variables and credentials, named by runner variable. */
export interface FeatureSandboxProfile {
  readonly environment: SandboxEnvironmentSpec;
  readonly credentials: SandboxCredentialSpec;
}

export interface FeatureOutline {
  /** The feature file, as the suite header names it, for example `features/subscribe.feature`. */
  readonly file: string;
  /** The catalog system the scenarios run against. */
  readonly system: string;
  /** The Sandbox profile name. */
  readonly sandbox: string;
  readonly profile: FeatureSandboxProfile;
  readonly scenarios: readonly FeatureScenario[];
}

/** The body is the library call for a sentence, with the values and argument the call passes. */
export interface LibraryCallBody {
  readonly kind: 'library';
  readonly expression: string;
  readonly values: readonly StepValue[];
  readonly argument: StepArgument;
}

/** The body is the rendered TODO, which throws until someone writes the step. */
export interface TodoBody {
  readonly kind: 'todo';
}

/** The body is code someone wrote. */
export interface WrittenBody {
  readonly kind: 'written';
}

export type SuiteStepBody = LibraryCallBody | TodoBody | WrittenBody;

/** One `test.step('<keyword> <text>', ...)` of a suite test. */
export interface SuiteStep {
  readonly keyword: string;
  readonly text: string;
  readonly line: number;
  readonly body: SuiteStepBody;
}

/** One test of the suite: its title is the scenario title. */
export interface SuiteScenario {
  readonly title: string;
  readonly line: number;
  readonly steps: readonly SuiteStep[];
}

export interface SuiteOutline {
  /** The suite file, as a fix names it, for example `tests/subscribe.spec.ts`. */
  readonly file: string;
  /** The feature file the suite was generated from. */
  readonly feature: string;
  readonly system: string;
  readonly sandbox: string;
  readonly scenarios: readonly SuiteScenario[];
}
