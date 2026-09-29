import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verify } from './playwright-evidence.mjs';

const resultsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
const result = await verify(resultsRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
