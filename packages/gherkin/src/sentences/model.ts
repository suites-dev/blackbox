// The sentences a feature may use, as plain data. The step library that
// implements them lives in another package and produces this shape; this
// package never imports it. Matching, capability and barrier checks read only
// what is declared here.

/** A parameter type an expression uses beyond Cucumber's built-in ones ({int}, {string}, {word}, ...). */
export interface SentenceParameterType {
  /** The name written in braces in an expression, for example `pointer` for `{pointer}`. */
  readonly name: string;
  /** The regular expression source a value must match, without anchors or flags. */
  readonly pattern: string;
}

/** The doc string or data table a sentence takes; a step written with another one is an error. */
export type SentenceArgument = 'none' | 'doc-string' | 'data-table';

export interface Sentence {
  /** A Cucumber expression, for example `the response status is {int}`. */
  readonly expression: string;
  /** Custom parameter types the expression uses; empty when it uses only built-in ones. */
  readonly parameterTypes: readonly SentenceParameterType[];
  readonly argument: SentenceArgument;
  /** The capability the sentence needs, or null. A capability the runtime does not offer is an error. */
  readonly requires: string | null;
  /** True for a completion barrier: a step after which the flow under test has finished. */
  readonly barrier: boolean;
  /** True when a completion barrier must come before this step in the same scenario. */
  readonly needsBarrier: boolean;
  /** Step text an author can copy; it matches this sentence. */
  readonly example: string;
}

/** The package that implements the sentences, as installed in the project. */
export interface SentenceLibrary {
  readonly name: string;
  readonly version: string;
}

/** Every sentence a feature may use, with the library and runtime that provide them. */
export interface SentenceList {
  readonly library: SentenceLibrary;
  /** Capabilities the runtime offers. */
  readonly capabilities: readonly string[];
  readonly sentences: readonly Sentence[];
}
