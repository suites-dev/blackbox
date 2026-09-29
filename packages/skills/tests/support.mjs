import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { validateAudit } from '../dist/src/index.js';

export function example(name = 'http') {
  const read = (file) => JSON.parse(readFileSync(new URL(`../examples/${name}/${file}.json`, import.meta.url), 'utf8'));
  return { audit: read('audit'), receipts: read('receipts') };
}

export function rejected(audit, receipts, code) {
  const result = validateAudit(audit, receipts);
  assert.equal(result.kind, 'rejected');
  assert.ok(result.diagnostics.some((item) => item.code === code), JSON.stringify(result));
}

export function mutate(change, code, name = 'http') {
  const { audit, receipts } = example(name);
  change(audit, receipts);
  rejected(audit, receipts, code);
}
