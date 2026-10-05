import { createRequire } from 'node:module';

import { OFFERED_CAPABILITIES } from '../runtime/capabilities.js';
import { createStepLibrary } from '../runtime/registry.js';
import type { StepDefinition } from '../runtime/step-types.js';

// src/library and dist/library sit at the same depth below the package root.
const manifest = createRequire(import.meta.url)('../../package.json') as {
  readonly name: string;
  readonly version: string;
};

/**
 * The shared, reviewed step vocabulary (hard rule 3). It is closed: projects
 * cannot add steps, and the compiler resolves every feature step against it.
 * The v1 vocabulary (setup, stimulus, barrier, response and state steps)
 * lands separately; until then every feature step is undefined.
 */
const definitions: readonly StepDefinition[] = [];

export const library = createStepLibrary({
  name: manifest.name,
  version: manifest.version,
  definitions,
  capabilities: OFFERED_CAPABILITIES,
});
