import type { DiagnosticSink } from '../feature/diagnostics.js';
import type { FeatureScenario, FeatureStep, StepArgument } from '../feature/model.js';
import type { SentenceMatcher } from '../sentences/match.js';
import type { Sentence } from '../sentences/model.js';

/** What steps are checked against: the sentence list and the capabilities its runtime offers. */
export interface StepContext {
  readonly match: SentenceMatcher;
  readonly capabilities: ReadonlySet<string>;
}

/** A step with the sentence it matched, or null when it matched none. */
export interface CheckedStep {
  readonly step: FeatureStep;
  readonly sentence: Sentence | null;
}

const ARGUMENT_NAMES = {
  'doc-string': 'a doc string',
  'data-table': 'a data table',
  none: 'no doc string or data table',
} as const satisfies Readonly<Record<StepArgument['kind'], string>>;

const quoted = (step: FeatureStep): string => `"${step.keyword} ${step.text}"`;

/** Matches one step against the sentence list and reports every reason it cannot be used. */
export function checkStep(
  step: FeatureStep,
  context: StepContext,
  sink: DiagnosticSink,
): CheckedStep {
  const match = context.match(step.text);
  switch (match.status) {
    case 'undefined':
      sink.report(
        'undefined-sentence',
        step,
        `undefined step ${quoted(step)}; only sentences of the step library are allowed`,
      );
      return { step, sentence: null };
    case 'ambiguous':
      sink.report(
        'ambiguous-sentence',
        step,
        `ambiguous step ${quoted(step)} matches ${match.expressions.map((expression) => JSON.stringify(expression)).join(', ')}`,
      );
      return { step, sentence: null };
    case 'matched':
      break;
  }
  const { sentence } = match;
  if (sentence.requires !== null && !context.capabilities.has(sentence.requires)) {
    sink.report(
      'capability',
      step,
      `step ${quoted(step)} needs capability "${sentence.requires}", which this Blackbox runtime does not offer`,
    );
  }
  if (sentence.argument !== step.argument.kind) {
    sink.report(
      'argument',
      step,
      `step ${quoted(step)} expects ${ARGUMENT_NAMES[sentence.argument]} but has ${ARGUMENT_NAMES[step.argument.kind]}`,
    );
  }
  return { step, sentence };
}

/**
 * Rules over one scenario as it runs, Background steps first: it needs a Then
 * step of its own, and a step that needs a completion barrier needs one
 * earlier in the same run.
 */
export function checkScenario(
  scenario: FeatureScenario,
  run: readonly CheckedStep[],
  sink: DiagnosticSink,
): void {
  if (scenario.steps.length > 0 && !scenario.steps.some((step) => step.outcome)) {
    sink.report(
      'then',
      scenario,
      `"${scenario.title}" has no Then step; a scenario needs at least one Then`,
    );
  }
  let sealed = false;
  for (const { step, sentence } of run) {
    if (sentence === null) {
      continue;
    }
    if (sentence.needsBarrier && !sealed) {
      sink.report(
        'barrier',
        step,
        `step ${quoted(step)} needs a completion barrier step before it`,
      );
    }
    sealed = sealed || sentence.barrier;
  }
}
