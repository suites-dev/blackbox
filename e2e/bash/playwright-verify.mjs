import { verify } from './playwright-evidence.mjs';

const [resultsRoot] = process.argv.slice(2);
const result = await verify(resultsRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
