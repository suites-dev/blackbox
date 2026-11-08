import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorHistory, ingestPlaywrightResults } from '@suites/blackbox-playwright/history';
import { verifyDurableLifecycle } from './playwright-lifecycle-durable.mjs';
import { expectedLifecycleCases, verifyLifecycleReport } from './playwright-lifecycle-report.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const results = join(root, 'test-results/lifecycle');
const report = JSON.parse(await readFile(join(results, 'results.json'), 'utf8'));
const cases = verifyLifecycleReport(report);
const discovery = await readFile(join(results, 'discovery.txt'), 'utf8');
for (const [title] of expectedLifecycleCases) {
  assert.equal(discovery.split(title).length - 1, 1, `unexpected discovery count for ${title}`);
}
const expectedSnapshot = '[\n  {\n    "id": "subscription_alice",\n    "status": "active"\n  }\n]\n';
assert.equal(await readFile(join(results, 'subscription-state.expected.txt'), 'utf8'), expectedSnapshot);
assert.equal(await readFile(join(root, 'tests/playwright-lifecycle/snapshots/subscription-state.txt'), 'utf8'), expectedSnapshot);
const observations = [];
for (const [index, name, calls] of [[0, 'lifecycle-action', 1], [1, 'lifecycle-blocked', 0], [2, 'lifecycle-capture-failed', 0]]) {
  const attachment = cases[index].tests[0].results[0].attachments.find((item) => item.name === name);
  assert(attachment, `missing ${name} evidence`);
  const body = attachment.body === undefined
    ? await readFile(attachment.path, 'utf8') : Buffer.from(attachment.body, 'base64').toString('utf8');
  const value = JSON.parse(body);
  assert.equal(value.calls, calls);
  assert.equal(typeof value.sandboxId, 'string');
  assert.equal(typeof value.executionId, 'string');
  if (index === 0) assert.equal(value.status, 201);
  if (index === 1) assert.equal(value.phase, 'precondition');
  if (index === 2) assert.equal(value.phase, 'initial-capture');
  observations.push(value);
}
assert.equal(new Set(observations.map(({ sandboxId }) => sandboxId)).size, 3);
assert.equal(new Set(observations.map(({ executionId }) => executionId)).size, 3);
const recovery = JSON.parse(await readFile(join(root, 'test-results/recovery.json'), 'utf8'));
assert.equal(recovery.kind, 'playwright-sandbox-recovery');
const execute = promisify(execFile);
for (const item of observations) {
  const matches = recovery.recoveries.filter(({ sandboxId }) => sandboxId === item.sandboxId);
  assert.equal(matches.length, 1, 'missing unique sandbox cleanup record');
  const result = matches[0].result;
  assert.equal(result.kind, 'sandbox-recovery-not-required');
  assert.equal(result.reason, 'already-clean');
  assert.equal(result.record.kind, 'available');
  assert.equal(result.record.value.cleanup, 'complete');
  const project = result.record.value.projectName;
  for (const args of [
    ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
    ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
    ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${project}`],
  ]) {
    const { stdout } = await execute('docker', args);
    assert.equal(stdout.trim(), '', `resources remain for ${project}`);
  }
}
const packageRoot = await realpath(join(root, 'node_modules/@suites/blackbox-playwright'));
const entrypoint = fileURLToPath(import.meta.resolve('@suites/blackbox-playwright'));
const difference = relative(root, packageRoot);
assert(difference !== '' && !difference.startsWith('..') && !isAbsolute(difference));
assert(entrypoint.startsWith(`${packageRoot}/dist/`));
const durable = await verifyDurableLifecycle(results, cases, { BehaviorHistory, ingestPlaywrightResults });
const receipt = { kind: 'playwright-lifecycle-proof', durable, cases: expectedLifecycleCases.map(([title, status]) => ({ title, status })),
  snapshot: 'subscription-state.txt', observations, recovery, packageBoundary: { packageRoot, entrypoint } };
await writeFile(join(results, 'receipt.json'), JSON.stringify(receipt, null, 2));
