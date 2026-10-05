import type { PickleDocString } from '@cucumber/messages';

import type { StepArgument, StepLibrary } from '../../runtime/step-types.js';
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

/** Resolves one step against the closed library. Returns null after reporting why it cannot run. */
export function planStep(
  source: StepSource,
  library: StepLibrary,
  sink: DiagnosticSink,
): PlannedStep | null {
  const quoted = `"${source.keyword} ${source.text}"`;
  const resolution = library.resolve(source.text);
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
  const { definition } = resolution;
  if (definition.argument !== source.argument.kind) {
    sink.report(
      source,
      `step ${quoted} expects ${ARGUMENT_NAMES[definition.argument]} but has ${ARGUMENT_NAMES[source.argument.kind]}`,
    );
    return null;
  }
  return { ...source, definition };
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
