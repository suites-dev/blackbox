import { createStepLibrary } from '../../runtime/registry.js';
import type { Capability, StepDefinition, StepLibrary } from '../../runtime/step-types.js';

// Test-only vocabulary for compiler tests. It covers every step kind, every
// argument shape, both gated capabilities and one deliberately ambiguous pair.
// The bodies never run: generated code is executed against a recording runtime.

const noop = (): Promise<void> => Promise.resolve();

function step(
  expression: string,
  shape: Pick<StepDefinition, 'kind' | 'argument' | 'fixtures'>,
  requires: Capability | null = null,
): StepDefinition {
  return { expression, ...shape, requires, run: noop };
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
  step('the response status is {int}', { kind: 'response-claim', argument: 'none', fixtures: ['world'] }),
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

export function compilerTestLibrary(capabilities: readonly Capability[] = []): StepLibrary {
  return createStepLibrary({
    name: 'compiler-test-library',
    version: '0.0.0',
    definitions,
    capabilities,
  });
}
