import type { test } from '@suites/blackbox-playwright';

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
  | 'setup'
  | 'stimulus'
  | 'barrier'
  | 'response-claim'
  | 'state-claim'
  | 'effects-claim';

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

export type StepFixtureName = 'effects' | 'page' | 'request' | 'sandbox' | 'telemetry' | 'world';

export type StepFixtures = Partial<
  Readonly<
    Pick<NativeTestArgs, Exclude<StepFixtureName, 'world'>> & {
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

export interface StepDefinition {
  /** A Cucumber expression, for example `the response status is {int}`. */
  readonly expression: string;
  readonly kind: StepKind;
  /** The doc string or data table the step expects; a mismatch is a compile error. */
  readonly argument: StepArgument['kind'];
  /** The native fixtures the step reads. Only these are destructured by the generated test. */
  readonly fixtures: readonly StepFixtureName[];
  readonly requires: Capability | null;
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

export interface StepLibraryIdentity {
  readonly name: string;
  readonly version: string;
  /** sha256 over every definition's expression, kind, argument, fixtures and capability. */
  readonly vocabularyHash: string;
}

/** A closed, read-only step vocabulary. There is no registration API. */
export interface StepLibrary {
  readonly identity: StepLibraryIdentity;
  readonly capabilities: readonly Capability[];
  resolve(text: string): StepResolution;
}
