import { resolve } from 'node:path';

import { verify } from './playwright-evidence.mjs';

const [resultsArgument] = process.argv.slice(2);
if (resultsArgument === undefined) {
  throw new Error('Usage: playwright-verify.mjs <results-root>');
}
const resultsRoot = resolve(resultsArgument);
const result = await verify(resultsRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
