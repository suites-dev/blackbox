import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recoverSandbox } from '../../packages/sandbox/dist/index.js';

import { recover } from './playwright-evidence.mjs';

const resultsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
const result = await recover(resultsRoot, recoverSandbox);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
