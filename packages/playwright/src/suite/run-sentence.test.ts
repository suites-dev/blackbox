import { afterEach, describe, expect, it } from 'vitest';

import { recordingLibrary } from '../library/testing/recording-library.js';
import { scenarioAt } from '../library/testing/step-harness.js';
import { useStubSystems } from '../library/testing/stub-lifecycle.js';
import { createSentenceRunner, runSentence } from './run-sentence.js';

// Requirement: a rendered library step calls the library by expression with
// the feature's values. The call runs that sentence's body with those values,
// runs the sentence's own checks first, and fails without running anything
// when the library has no such sentence or does not offer its capability.

const system = useStubSystems(afterEach);
const NONE = { kind: 'none' } as const;

function recordingRunner() {
  const { inputs, library } = recordingLibrary();
  return { inputs, run: createSentenceRunner(library) };
}

describe('runSentence', () => {
  it('runs the sentence named by its expression with the values passed', async () => {
    const { inputs, run } = recordingRunner();
    const fixtures = { world: new Map() };
    await run(fixtures, 'the status is {int}', [201], NONE);
    expect(inputs).toEqual([{ fixtures, parameters: [201], argument: NONE }]);
  });

  it('fails without running a body for an unknown sentence, a missing capability or a failed check', async () => {
    const { inputs, run } = recordingRunner();
    await expect(run({}, 'the status is 201', [], NONE)).rejects.toThrow(
      'The step library has no sentence "the status is 201"; check the suite for drift',
    );
    await expect(run({}, 'the effects hold for {int}', [1], NONE)).rejects.toThrow(
      'Sentence "the effects hold for {int}" needs capability "effects-claims", which this Blackbox runtime does not offer',
    );
    await expect(run({}, 'the status is {int}', [0], NONE)).rejects.toThrow(
      'Sentence "the status is {int}": status 0 is not an HTTP status',
    );
    expect(inputs).toEqual([]);
  });

  it('runs the shared library against a system, and its claims fail when the system disagrees', async () => {
    const attempt = scenarioAt((await system('correct')).url);
    await runSentence(attempt.fixtures, 'the client sends GET {string}', ['/health'], NONE);
    await runSentence(attempt.fixtures, 'the response status is {int}', [200], NONE);
    await expect(
      runSentence(attempt.fixtures, 'the response status is {int}', [503], NONE),
    ).rejects.toThrow('status of GET /health');
  });
});
