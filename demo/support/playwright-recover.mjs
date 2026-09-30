import { recoverSandbox } from '@suites/blackbox-sandbox';

import { recover } from './playwright-evidence.mjs';

const result = await recover(recoverSandbox);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
