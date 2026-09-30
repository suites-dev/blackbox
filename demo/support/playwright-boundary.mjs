import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { boundary } from './playwright-evidence.mjs';

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const result = await boundary(consumerRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
