import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dockerResources } from './playwright-evidence.mjs';

const root = join(import.meta.dirname, 'test-results');
const { runs } = JSON.parse(await readFile(join(root, 'payment/receipt.json')));
const { recoveries } = JSON.parse(await readFile(join(root, 'recovery.json')));
assert.equal(runs.length, 3);
const projects = [];
for (const run of runs) {
  const matches = recoveries.filter((row) => row.sandboxId === run.sandboxId);
  assert.equal(matches.length, 1);
  const { result } = matches[0];
  assert.equal(result.kind, 'sandbox-recovery-not-required');
  assert.equal(result.reason, 'already-clean');
  assert.equal(result.record.kind, 'available');
  const record = result.record.value;
  assert.equal(record.cleanup, 'complete');
  assert.equal(record.sandboxId, run.sandboxId);
  assert.deepEqual(await dockerResources(record.projectName), []);
  projects.push({
    phase: run.phase,
    sandboxId: run.sandboxId,
    project: record.projectName,
    cleanup: record.cleanup,
  });
}
assert.equal(new Set(projects.map((row) => row.project)).size, 3);
await writeFile(join(root, 'payment/cleanup.json'), JSON.stringify(projects, null, 2));
