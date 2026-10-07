import type { CatalogEntrySummary } from '@suites/blackbox-catalog';

import { formatValidationError } from '../../feature/diagnostics.js';
import { sentenceMatcher } from '../../sentences/match.js';
import type { Sentence, SentenceList } from '../../sentences/model.js';
import { validateFeature } from '../feature.js';

// A test-only sentence list. It covers every argument shape, a barrier, a
// sentence that needs one, both gated capabilities, a custom parameter type
// and one deliberately ambiguous pair. Examples are the expressions themselves.

type Shape = Partial<Omit<Sentence, 'expression' | 'example'>>;

function sentence(expression: string, shape: Shape = {}): Sentence {
  return {
    expression,
    parameterTypes: [],
    argument: 'none',
    requires: null,
    barrier: false,
    needsBarrier: false,
    example: expression,
    ...shape,
  };
}

const POINTER = { name: 'pointer', pattern: '/[^\\s"]*' };

export const TEST_SENTENCES = [
  sentence('the account {string} exists'),
  sentence('the client sends {word} {string}'),
  sentence('the client sends {word} {string} with JSON:', { argument: 'doc-string' }),
  sentence('the client sends these requests concurrently:', { argument: 'data-table' }),
  sentence('the flow is sealed by the terminal response(s)', { barrier: true }),
  sentence('the response status is {int}'),
  sentence('the response has {int} item(s) at {pointer}', { parameterTypes: [POINTER] }),
  sentence('the state at {string} equals:', { argument: 'doc-string' }),
  sentence('the effects satisfy:', {
    argument: 'data-table',
    requires: 'effects-claims',
    needsBarrier: true,
  }),
  sentence('the {string} participant runs SQL:', {
    argument: 'doc-string',
    requires: 'participant-exec',
  }),
  // Ambiguous with each other for `the queue "orders" is empty`.
  sentence('the queue {string} is empty'),
  sentence('the queue {word} is empty'),
] as const satisfies readonly Sentence[];

export function testSentences(capabilities: readonly string[] = []): SentenceList {
  return {
    library: { name: '@example/step-library', version: '1.2.3' },
    capabilities,
    sentences: TEST_SENTENCES,
  };
}

export const testCatalog = [
  { id: 'payment-mock', kind: 'subsystem', isDefault: false },
  { id: 'subscription-system', kind: 'system', isDefault: true },
] as const satisfies readonly CatalogEntrySummary[];

/** Validates one feature and returns its errors as `file:line:column: message`, or [] when it is valid. */
export function errorsOf(source: string, capabilities: readonly string[] = []): readonly string[] {
  const sentences = testSentences(capabilities);
  return validateFeature(source, 'features/probe.feature', {
    catalog: testCatalog,
    sandboxProfiles: ['bare', 'default'],
    match: sentenceMatcher(sentences),
    capabilities: new Set(sentences.capabilities),
  }).map(formatValidationError);
}

/** A feature around the given body lines, with the given tag line on top. */
export function featureWith(featureTags: string, body: string): string {
  return `${featureTags}\nFeature: probe\n\n${body}\n`;
}

export const SELECTED = '@system:subscription-system @sandbox:default';
