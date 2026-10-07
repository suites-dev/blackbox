import type { StepLibrary } from '../../step-runtime/library.js';
import { createStepLibrary } from '../../step-runtime/registry.js';
import type { StepDefinition, StepInput } from '../../step-runtime/step-types.js';

// A two-sentence library whose bodies record their input, for tests of code
// that receives a finished StepLibrary. `the status is {int}` checks that its
// value is not 0; `the effects hold for {int}` needs a capability the library
// does not offer.

export interface RecordingLibrary {
  readonly inputs: readonly StepInput[];
  readonly library: StepLibrary;
}

export function recordingLibrary(): RecordingLibrary {
  const inputs: StepInput[] = [];
  const definition = (expression: string, requires: StepDefinition['requires']): StepDefinition => ({
    expression,
    kind: 'response-claim',
    argument: 'none',
    fixtures: ['world'],
    requires,
    credentialParameter: null,
    deadlineParameter: null,
    example: expression,
    check: ({ parameters }) => (parameters[0] === 0 ? ['status 0 is not an HTTP status'] : []),
    run: (input) => {
      inputs.push(input);
      return Promise.resolve();
    },
  });
  const library = createStepLibrary({
    name: 'n',
    version: '1',
    definitions: [
      definition('the status is {int}', null),
      definition('the effects hold for {int}', 'effects-claims'),
    ],
    capabilities: [],
  });
  return { inputs, library };
}
