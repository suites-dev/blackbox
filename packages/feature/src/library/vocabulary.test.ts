import { describe, expect, it } from 'vitest';

import { createStepLibrary } from '../runtime/registry.js';
import type { StepDefinition } from '../runtime/step-types.js';
import { library } from './index.js';
import { GATED, V1 } from './testing/vocabulary.js';

// Requirements (task 2.3, report sections 4.3 and 6.2): the shared library is
// closed and offers exactly the v1 vocabulary (setup, stimulus, barrier,
// response and state steps); each sample text resolves to its own step, so no
// two steps are ambiguous; effects claims and participant commands are not in
// v1 and the runtime offers no capability. Task 2.4: steps that read state
// name a credential of the feature's Sandbox profile, and polling barriers
// carry their deadline, at the parameters listed here. Benchmark F2: response
// claims address members of the body by JSON Pointer, as state claims do.
// Benchmark F14: the planned effects claim and participant command are listed
// with the capability they need, so a feature that uses one fails to compile
// naming that capability instead of reporting an undefined step.

describe('step library v1', () => {
  it('resolves each sample to exactly its own step, with no capability required', () => {
    for (const {
      sample,
      expression,
      kind,
      argument,
      fixtures,
      credentialParameter,
      deadlineParameter,
    } of V1) {
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
      expect(
        {
          credentialParameter: definition.credentialParameter,
          deadlineParameter: definition.deadlineParameter,
        },
        sample,
      ).toEqual({
        credentialParameter,
        deadlineParameter,
      });
    }
  });

  it('gives every step an example that resolves to that step', () => {
    for (const { sample, expression } of V1) {
      const step = library.resolve(sample);
      const example = step.status === 'resolved' ? library.resolve(step.definition.example) : step;
      const resolved =
        example.status === 'resolved' ? example.definition.expression : example.status;
      expect(resolved, sample).toBe(expression);
    }
  });

  it('defines nothing else and offers no capability', () => {
    // The hash covers bodies and checks, so the listed steps take the library's own; another step or a missing one changes it.
    const codeOf = (sample: string): Pick<StepDefinition, 'run' | 'check'> => {
      const step = library.resolve(sample);
      if (step.status !== 'resolved' && step.status !== 'unavailable') {
        throw new Error(`${sample} does not resolve`);
      }
      return { run: step.definition.run, check: step.definition.check };
    };
    const listed = createStepLibrary({
      name: library.identity.name,
      version: library.identity.version,
      definitions: [
        ...V1.map((entry) => ({
          ...entry,
          requires: null,
          example: entry.sample,
          ...codeOf(entry.sample),
        })),
        ...GATED.map((entry) => ({ ...entry, example: entry.sample, ...codeOf(entry.sample) })),
      ],
      capabilities: [],
    });
    expect(library.identity).toEqual(listed.identity);
    expect(library.identity.name).toBe('@suites/blackbox-feature');
    expect(library.capabilities).toEqual([]);
  });

  it('leaves invented steps undefined', () => {
    for (const text of [
      'the client sends POST "/subscriptions"',
      'the client sends DELETE "/health"',
      'the response status is 201 within 5 seconds',
      'the state at "/s" equals:',
    ]) {
      expect(library.resolve(text), text).toEqual({ status: 'undefined' });
    }
  });
});

describe('gated steps (benchmark F14)', () => {
  it('lists effects claims and participant commands with a capability this runtime does not offer', () => {
    for (const { sample, expression, kind, argument, requires } of GATED) {
      expect(library.resolve(sample), sample).toEqual({
        status: 'unavailable',
        capability: requires,
        definition: expect.objectContaining({ expression, kind, argument, requires }),
      });
    }
  });
});
