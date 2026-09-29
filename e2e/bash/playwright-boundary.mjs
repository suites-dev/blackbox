import { boundary } from './playwright-evidence.mjs';

const [consumerRoot, workspaceRoot] = process.argv.slice(2);
const result = await boundary(consumerRoot, workspaceRoot);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
