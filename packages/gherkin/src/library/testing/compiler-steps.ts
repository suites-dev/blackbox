import { createStepLibrary } from '../../runtime/registry.js';
import type { StepLibrary } from '../../runtime/library.js';
import type { Capability, StepDefinition } from '../../runtime/step-types.js';

// Test-only vocabulary for compiler tests. It covers every step kind, every
// argument shape, both gated capabilities, a credential and a deadline
// parameter, and one deliberately ambiguous pair. Bodies are no-ops unless a
// test supplies stub bodies for a real Playwright run; the vocabulary hash
// never covers bodies, so stubs do not change compiled output. Examples are
// the expressions themselves: only the shared library's examples are checked.

const noop = (): Promise<void> => Promise.resolve();

type Shape = Pick<StepDefinition, 'kind' | 'argument' | 'fixtures'> &
  Partial<Pick<StepDefinition, 'credentialParameter' | 'deadlineParameter'>>;

function step(expression: string, shape: Shape, requires: Capability | null = null): StepDefinition {
  return {
    expression,
    credentialParameter: null,
    deadlineParameter: null,
    ...shape,
    requires,
    example: expression,
    run: noop,
  };
}

const http = ['request', 'sandbox', 'world'] as const;

const definitions = [
  step('the account {string} exists', { kind: 'setup', argument: 'none', fixtures: http }),
  step('the client sends {word} {string}', { kind: 'stimulus', argument: 'none', fixtures: http }),
  step('the client sends {word} {string} with JSON:', {
    kind: 'stimulus',
    argument: 'doc-string',
    fixtures: http,
  }),
  step('the client sends these requests concurrently:', {
    kind: 'stimulus',
    argument: 'data-table',
    fixtures: http,
  }),
  step('the flow is sealed by the terminal response(s)', {
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
  }),
  step('the flow is sealed within {int} second(s)', {
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
    deadlineParameter: 0,
  }),
  step('the response status is {int}', { kind: 'response-claim', argument: 'none', fixtures: ['world'] }),
  step('the state at {string} as {string} has {int} item(s)', {
    kind: 'state-claim',
    argument: 'none',
    fixtures: ['credentials', 'request', 'sandbox'],
    credentialParameter: 1,
  }),
  step('the state at {string} equals:', {
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: ['request', 'sandbox'],
  }),
  step(
    'the effects satisfy:',
    { kind: 'effects-claim', argument: 'data-table', fixtures: ['effects', 'world'] },
    'effects-claims',
  ),
  step(
    'the {string} participant runs SQL:',
    { kind: 'setup', argument: 'doc-string', fixtures: ['sandbox'] },
    'participant-exec',
  ),
  // Ambiguous with each other for `the queue "orders" is empty`.
  step('the queue {string} is empty', { kind: 'state-claim', argument: 'none', fixtures: ['sandbox'] }),
  step('the queue {word} is empty', { kind: 'state-claim', argument: 'none', fixtures: ['sandbox'] }),
] satisfies readonly StepDefinition[];

/** Step bodies keyed by expression, for tests that run generated code under Playwright. */
export type StubStepBodies = Readonly<Record<string, StepDefinition['run']>>;

export function compilerTestLibrary(
  capabilities: readonly Capability[] = [],
  bodies: StubStepBodies = {},
): StepLibrary {
  const unknown = Object.keys(bodies).filter(
    (expression) => !definitions.some((definition) => definition.expression === expression),
  );
  if (unknown.length > 0) {
    throw new Error(`No test step is defined for stub bodies: ${unknown.join(', ')}`);
  }
  return createStepLibrary({
    name: 'compiler-test-library',
    version: '0.0.0',
    definitions: definitions.map((definition) =>
      Object.hasOwn(bodies, definition.expression)
        ? { ...definition, run: bodies[definition.expression] }
        : definition,
    ),
    capabilities,
  });
}
