import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { recover } from './playwright-evidence.mjs';

const [resultsArgument, consumerArgument] = process.argv.slice(2);
if (resultsArgument === undefined || consumerArgument === undefined) {
  throw new Error('Usage: playwright-recover.mjs <results-root> <consumer-root>');
}
const resultsRoot = resolve(resultsArgument);
const consumerRoot = resolve(consumerArgument);
const sandboxEntrypoint = join(
  consumerRoot,
  'node_modules',
  '@suites',
  'blackbox-sandbox',
  'dist',
  'index.js',
);
const { recoverSandbox } = await import(pathToFileURL(sandboxEntrypoint).href);
const result = await recover(resultsRoot, recoverSandbox);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
