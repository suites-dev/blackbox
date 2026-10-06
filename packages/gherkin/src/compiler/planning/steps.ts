import type { PickleDocString } from '@cucumber/messages';

import type { SandboxCredentialSpec } from '../../runtime/credentials.js';
import type { StepLibrary } from '../../runtime/library.js';
import type { StepArgument, StepDefinition } from '../../runtime/step-types.js';
import type { DiagnosticSink, SourceLocation } from './diagnostics.js';
import type { PlannedStep } from './model.js';

export interface StepSource extends SourceLocation {
  readonly keyword: string;
  readonly text: string;
  readonly argument: StepArgument;
}

type DocStringLike = Pick<PickleDocString, 'content' | 'mediaType'>;

interface TableLike {
  readonly rows: readonly { readonly cells: readonly { readonly value: string }[] }[];
}

/** Normalizes a Gherkin doc string or data table (AST or pickle) to plain data. */
export function stepArgument(
  docString: DocStringLike | undefined,
  dataTable: TableLike | undefined,
): StepArgument {
  if (docString !== undefined) {
    return { kind: 'doc-string', content: docString.content, mediaType: docString.mediaType ?? null };
  }
  if (dataTable !== undefined) {
    return { kind: 'data-table', rows: dataTable.rows.map((row) => row.cells.map((cell) => cell.value)) };
  }
  return { kind: 'none' };
}

const ARGUMENT_NAMES = {
  'doc-string': 'a doc string',
  'data-table': 'a data table',
  none: 'no doc string or data table',
} as const satisfies Readonly<Record<StepArgument['kind'], string>>;

/** What a feature's steps resolve against: the closed library and the selected Sandbox profile. */
export interface StepScope {
  readonly library: StepLibrary;
  /** Null when the Feature selects no valid profile; that is reported once, at the Feature. */
  readonly profile: { readonly name: string; readonly credentials: SandboxCredentialSpec } | null;
}

function known(values: readonly string[]): string {
  return values.length === 0 ? 'it defines none' : `it defines ${[...values].sort().join(', ')}`;
}

/** A credential parameter must name a credential of the feature's Sandbox profile. */
function checkCredential(
  step: { readonly source: StepSource; readonly definition: StepDefinition; readonly parameters: readonly unknown[] },
  profile: StepScope['profile'],
  sink: DiagnosticSink,
): void {
  const index = step.definition.credentialParameter;
  if (index === null || profile === null) {
    return;
  }
  const name = step.parameters[index];
  if (typeof name !== 'string') {
    throw new TypeError(`Step ${JSON.stringify(step.definition.expression)} parameter ${index} is not a credential name`);
  }
  const names = Object.keys(profile.credentials);
  if (!names.includes(name)) {
    sink.report(
      step.source,
      `credential "${name}" is not defined by Sandbox profile "${profile.name}" (${known(names)})`,
    );
  }
}

/** Resolves one step against the closed library. Returns null after reporting why it cannot run. */
export function planStep(source: StepSource, scope: StepScope, sink: DiagnosticSink): PlannedStep | null {
  const quoted = `"${source.keyword} ${source.text}"`;
  const resolution = scope.library.resolve(source.text);
  switch (resolution.status) {
    case 'undefined':
      sink.report(source, `undefined step ${quoted}; only steps from the shared Blackbox step library are allowed`);
      return null;
    case 'ambiguous':
      sink.report(
        source,
        `ambiguous step ${quoted} matches ${resolution.expressions.map((expression) => JSON.stringify(expression)).join(', ')}`,
      );
      return null;
    case 'unavailable':
      sink.report(
        source,
        `step ${quoted} needs capability "${resolution.capability}", which this Blackbox runtime does not offer`,
      );
      return null;
    case 'resolved':
      break;
  }
  const { definition, parameters } = resolution;
  if (definition.argument !== source.argument.kind) {
    sink.report(
      source,
      `step ${quoted} expects ${ARGUMENT_NAMES[definition.argument]} but has ${ARGUMENT_NAMES[source.argument.kind]}`,
    );
    return null;
  }
  checkCredential({ source, definition, parameters }, scope.profile, sink);
  // Argument values are checked here, so a mistake costs a compile instead of a Sandbox acquisition.
  const problems = definition.check === null ? [] : definition.check({ parameters, argument: source.argument });
  for (const problem of problems) {
    sink.report(source, `step ${quoted}: ${problem}`);
  }
  return { ...source, definition, parameters };
}

export interface ScenarioCheck extends SourceLocation {
  readonly title: string;
  /** Steps inherited from Backgrounds, in run order. */
  readonly background: readonly PlannedStep[];
  readonly steps: readonly PlannedStep[];
}

/**
 * Structural rules that keep a scenario a protocol with claims: it must make
 * at least one claim of its own, and an effects claim needs a completion
 * barrier earlier in the same run.
 */
export function checkScenario(scenario: ScenarioCheck, sink: DiagnosticSink): void {
  if (!scenario.steps.some((step) => step.definition.kind.endsWith('-claim'))) {
    sink.report(
      scenario,
      `"${scenario.title}" makes no claim; a scenario needs at least one response, state or effects claim step`,
    );
  }
  let sealed = false;
  for (const step of [...scenario.background, ...scenario.steps]) {
    if (step.definition.kind === 'barrier') {
      sealed = true;
    } else if (step.definition.kind === 'effects-claim' && !sealed) {
      sink.report(
        step,
        `effects claim "${step.keyword} ${step.text}" needs a completion barrier step before it`,
      );
    }
  }
}
