import { describe, expect, it } from 'vitest';

import { createStepLibrary } from '../runtime/registry.js';
import type { StepDefinition } from '../runtime/step-types.js';
import { library } from './index.js';

// Requirements (task 2.3, report sections 4.3 and 6.2): the shared library is
// closed and offers exactly the v1 vocabulary (setup, stimulus, barrier,
// response and state steps); each sample text resolves to its own step, so no
// two steps are ambiguous; effects claims and participant commands are not in
// v1 and the runtime offers no capability.

type Entry = Pick<StepDefinition, 'expression' | 'kind' | 'argument' | 'fixtures'> & { readonly sample: string };

const http = ['request', 'sandbox'] as const;
const STATE = 'the state at {string} as {string}';

const V1 = [
  {
    sample: 'the client has sent POST "/subscriptions" with JSON and received 201:',
    expression: 'the client has sent {word} {string} with JSON and received {int}:',
    kind: 'setup',
    argument: 'doc-string',
    fixtures: http,
  },
  {
    sample: 'the client sends POST "/subscriptions" with JSON:',
    expression: 'the client sends {word} {string} with JSON:',
    kind: 'stimulus',
    argument: 'doc-string',
    fixtures: [...http, 'world'],
  },
  {
    sample: 'the client sends these requests concurrently:',
    expression: 'the client sends these requests concurrently:',
    kind: 'stimulus',
    argument: 'data-table',
    fixtures: [...http, 'world'],
  },
  {
    sample: 'the flow is sealed by the terminal responses',
    expression: 'the flow is sealed by the terminal response(s)',
    kind: 'barrier',
    argument: 'none',
    fixtures: ['world'],
  },
  {
    sample: 'the flow is sealed within 5 seconds when the state at "/s" as "c" has "/orders" equal to:',
    expression: `the flow is sealed within {int} second(s) when ${STATE} has {string} equal to:`,
    kind: 'barrier',
    argument: 'doc-string',
    fixtures: http,
  },
  {
    sample: 'the flow is sealed within 1 second when the state at "/s" as "c" has 1 item at "/orders"',
    expression: `the flow is sealed within {int} second(s) when ${STATE} has {int} item(s) at {string}`,
    kind: 'barrier',
    argument: 'none',
    fixtures: http,
  },
  {
    sample: 'the response status is 201',
    expression: 'the response status is {int}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
  },
  {
    sample: 'the response statuses are "201, 409"',
    expression: 'the response statuses are {string}',
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
  },
  {
    sample: 'the response JSON equals:',
    expression: 'the response JSON equals:',
    kind: 'response-claim',
    argument: 'doc-string',
    fixtures: ['world'],
  },
  {
    sample: 'the state at "/s" as "c" equals:',
    expression: `${STATE} equals:`,
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: http,
  },
  {
    sample: 'the state at "/s" as "c" has "/a" equal to:',
    expression: `${STATE} has {string} equal to:`,
    kind: 'state-claim',
    argument: 'doc-string',
    fixtures: http,
  },
  {
    sample: 'the state at "/s" as "c" has 2 items at "/a"',
    expression: `${STATE} has {int} item(s) at {string}`,
    kind: 'state-claim',
    argument: 'none',
    fixtures: http,
  },
] satisfies readonly Entry[];

describe('step library v1', () => {
  it('resolves each sample to exactly its own step, with no capability required', () => {
    for (const { sample, expression, kind, argument, fixtures } of V1) {
      const resolution = library.resolve(sample);
      if (resolution.status !== 'resolved') {
        throw new Error(`${sample} is ${resolution.status}`);
      }
      const { definition } = resolution;
      expect(
        { expression: definition.expression, kind: definition.kind, argument: definition.argument },
        sample,
      ).toEqual({ expression, kind, argument });
      expect([...definition.fixtures].sort(), sample).toEqual([...fixtures].sort());
      expect(definition.requires, sample).toBeNull();
    }
  });

  it('defines nothing else and offers no capability', () => {
    const listed = createStepLibrary({
      name: library.identity.name,
      version: library.identity.version,
      definitions: V1.map((entry) => ({ ...entry, requires: null, run: () => Promise.resolve() })),
      capabilities: [],
    });
    expect(library.identity).toEqual(listed.identity);
    expect(library.identity.name).toBe('@suites/blackbox-gherkin');
    expect(library.capabilities).toEqual([]);
  });

  it('leaves effects claims, participant commands and invented steps undefined', () => {
    for (const text of [
      'the effects satisfy:',
      'the "postgres" participant runs SQL:',
      'the client sends GET "/health"',
      'the response status is 201 within 5 seconds',
      'the state at "/s" equals:',
    ]) {
      expect(library.resolve(text), text).toEqual({ status: 'undefined' });
    }
  });
});
