import type { test } from '../fixtures.js';

import type { SandboxCredentials } from './credentials.js';

// @suites/blackbox-playwright exports the facade but not its argument types,
// so they are read from the facade's own signatures. Parameters<> takes the
// last overload: sandbox(name, options, callback) and test(title, details, body).
type Facade = typeof test;
type SystemScope = Parameters<Parameters<Facade['system']>[1]>[0];
type SandboxSuite = Parameters<Parameters<SystemScope['sandbox']>[2]>[0];
type NativeTestArgs = Parameters<Parameters<SandboxSuite['test']>[2]>[0];

/** The facade's native step: a titled, optionally boxed and located Playwright step. */
export type BlackboxStep = Facade['step'];

/**
 * What a step contributes to a scenario. The compiler reads the kind to
 * require at least one claim per scenario and a barrier before any effects
 * claim; nothing at run time reads it.
 */
export type StepKind =
  'setup' | 'stimulus' | 'barrier' | 'response-claim' | 'state-claim' | 'effects-claim';

/**
 * Runtime abilities a step may depend on. A step that names a capability the
 * installed runtime does not offer is a compile error, never a skipped step.
 *
 * - `effects-claims`: qualified telemetry verdicts, blocked on #26.
 * - `participant-exec`: commands inside a Sandbox participant, blocked on
 *   participant exec (#119 PW-5) and the driver contract (#39).
 */
export type Capability = 'effects-claims' | 'participant-exec';

/** Scenario-local state shared by the Background hooks and test body of one attempt. */
export type ScenarioWorld = Map<string, unknown>;

/**
 * Native fixtures a step can read, plus `credentials`, which the generated file
 * resolves from the Sandbox profile instead of asking Playwright for it.
 */
export type StepFixtureName =
  'credentials' | 'effects' | 'page' | 'request' | 'sandbox' | 'telemetry' | 'world';

export type StepFixtures = Partial<
  Readonly<
    Pick<NativeTestArgs, Exclude<StepFixtureName, 'credentials' | 'world'>> & {
      readonly credentials: SandboxCredentials;
      readonly world: ScenarioWorld;
    }
  >
>;

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

export type StepArgument = DocStringArgument | DataTableArgument | NoArgument;

export interface StepInput {
  readonly fixtures: StepFixtures;
  /** Values of the expression's parameters, in order. */
  readonly parameters: readonly unknown[];
  readonly argument: StepArgument;
}

/** What a step's compile-time check reads: the written values, never a fixture. */
export type StepCheckInput = Omit<StepInput, 'fixtures'>;

/** Returns what is wrong with a step's written values; empty when nothing is. */
export type StepCheck = (input: StepCheckInput) => readonly string[];

export interface StepDefinition {
  /** A Cucumber expression, for example `the response status is {int}`. */
  readonly expression: string;
  readonly kind: StepKind;
  /** The doc string or data table the step expects; a mismatch is a compile error. */
  readonly argument: StepArgument['kind'];
  /** The fixtures the step reads. Only these are destructured by the generated test. */
  readonly fixtures: readonly StepFixtureName[];
  readonly requires: Capability | null;
  /**
   * The expression parameter that names a credential. The compiler checks that
   * the feature's Sandbox profile defines it.
   */
  readonly credentialParameter: number | null;
  /**
   * The expression parameter that holds a barrier deadline in seconds. The
   * compiler records it in the compile manifest.
   */
  readonly deadlineParameter: number | null;
  /** Step text a human author can copy; it resolves to this definition. Not part of the vocabulary hash. */
  readonly example: string;
  /**
   * Checks the written values when the feature compiles, before any Sandbox
   * starts, or null when the expression's types are the whole check. Pure;
   * the body checks the same values again when it runs.
   */
  readonly check: StepCheck | null;
  readonly run: (input: StepInput) => Promise<void>;
}

export type StepResolution =
  | {
      readonly status: 'resolved';
      readonly definition: StepDefinition;
      readonly parameters: readonly unknown[];
    }
  | { readonly status: 'undefined' }
  | { readonly status: 'ambiguous'; readonly expressions: readonly string[] }
  | {
      readonly status: 'unavailable';
      readonly definition: StepDefinition;
      readonly capability: Capability;
    };
