import { verify } from './playwright-evidence.mjs';

const result = await verify();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
