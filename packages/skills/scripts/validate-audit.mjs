import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';
import process from 'node:process';
import { validateAudit } from '../dist/src/index.js';

const LIMIT = 2 * 1024 * 1024;

async function readJson(path) {
  const file = await open(path, 'r');
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > LIMIT) {
      throw new Error('Input must be a regular JSON file within the size limit.');
    }
    const bytes = Buffer.alloc(LIMIT + 1);
    let total = 0;
    while (total < bytes.length) {
      const result = await file.read(bytes, total, bytes.length - total, total);
      if (result.bytesRead === 0) {
        break;
      }
      total += result.bytesRead;
    }
    if (total > LIMIT) {
      throw new Error('Input exceeds the size limit.');
    }
    return JSON.parse(bytes.subarray(0, total).toString('utf8'));
  } finally {
    await file.close();
  }
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length !== 2) {
    process.stderr.write('Usage: node validate-audit.mjs <audit.json> <receipts.json>\n');
    process.exitCode = 2;
    return;
  }
  try {
    const audit = await readJson(paths[0]);
    const receipts = await readJson(paths[1]);
    const result = validateAudit(audit, receipts);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.kind === 'accepted' ? 0 : 1;
  } catch {
    process.stderr.write('{"kind":"failed","reason":"Input could not be read or validated. No submitted content was printed."}\n');
    process.exitCode = 3;
  }
}

await main();
