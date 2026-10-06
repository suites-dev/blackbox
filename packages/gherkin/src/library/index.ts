import { createRequire } from 'node:module';

import { OFFERED_CAPABILITIES } from '../runtime/capabilities.js';
import { createStepLibrary } from '../runtime/registry.js';
import { barrierSteps } from './steps/barrier.js';
import { responseSteps } from './steps/response.js';
import { setupSteps } from './steps/setup.js';
import { stateSteps } from './steps/state.js';
import { stimulusSteps } from './steps/stimulus.js';

// src/library and dist/library sit at the same depth below the package root.
const manifest = createRequire(import.meta.url)('../../package.json') as {
  readonly name: string;
  readonly version: string;
};

/**
 * The shared, reviewed step vocabulary (hard rule 3). It is closed: projects
 * cannot add steps, and the compiler resolves every feature step against it.
 * v1 covers setup, stimulus, completion barriers, and response and state
 * claims. Effects claims and participant commands are not part of v1, so a
 * feature that uses them does not compile.
 */
const definitions = [
  ...setupSteps,
  ...stimulusSteps,
  ...barrierSteps,
  ...responseSteps,
  ...stateSteps,
];

export const library = createStepLibrary({
  name: manifest.name,
  version: manifest.version,
  definitions,
  capabilities: OFFERED_CAPABILITIES,
});
