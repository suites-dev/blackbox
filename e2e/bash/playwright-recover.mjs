import { recoverSandbox } from '@suites/blackbox-sandbox';

import { recover } from './playwright-evidence.mjs';

const [resultsRoot] = process.argv.slice(2);
const result = await recover(resultsRoot, recoverSandbox);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
