import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { assertionChild } from './playwright-assertions-child.mjs';
import {
  digest,
  omitPaymentWrite,
  scenario,
  verifyPaymentReport,
} from './playwright-payment-proof.mjs';

const root = await realpath(import.meta.dirname);
assert.equal(basename(root), 'consumer');
assert.match(basename(dirname(root)), /^blackbox-capsule-assets\.[A-Za-z0-9]+$/u);
assert.equal(dirname(dirname(root)), await realpath(tmpdir()));
const sourcePath = join(root, 'sut/payment-acceptance/server.cjs');
assert.equal(await realpath(sourcePath), sourcePath);
const contractPath = join(root, 'tests/playwright-payment/payment-intents.spec.ts');
const snapshotPath = join(root, 'tests/playwright-payment/snapshots/payment-state.txt');
const results = join(root, 'test-results/payment');
await mkdir(results);
const original = await readFile(sourcePath, 'utf8');
const broken = omitPaymentWrite(original);
const hashes = {};
for (const [key, file] of [
  ['contract', contractPath],
  ['snapshot', snapshotPath],
]) {
  hashes[key] = digest(await readFile(file));
  await copyFile(file, join(results, basename(file)));
}

let child;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  child?.interrupt();
};
process.once('SIGTERM', interrupt);
process.once('SIGINT', interrupt);
const receipts = [];
try {
  for (const phase of ['good', 'broken', 'repaired']) {
    assert.ok(!interrupted, 'payment journey interrupted');
    const directory = join(results, phase);
    await mkdir(directory);
    const implementation = phase === 'broken' ? broken : original;
    if (phase !== 'good') await writeFile(sourcePath, implementation);
    await copyFile(sourcePath, join(directory, 'server.cjs'));
    const inputs = {
      implementation: digest(await readFile(sourcePath)),
      contract: digest(await readFile(contractPath)),
      snapshot: digest(await readFile(snapshotPath)),
    };
    await writeFile(join(directory, 'inputs.json'), JSON.stringify(inputs, null, 2));
    assert.equal(inputs.contract, hashes.contract);
    assert.equal(inputs.snapshot, hashes.snapshot);
    const config = ['test', '--config', join(root, 'playwright-payment.config.ts')];
    child = assertionChild(
      root,
      directory,
      { BLACKBOX_PAYMENT_RESULTS: directory },
      { deadlineMs: 300_000 },
    );
    assert.equal(await child.run([...config, '--list', '--reporter=line'], 'discovery.txt'), 0);
    const discovery = await readFile(join(directory, 'discovery.txt'), 'utf8');
    assert.equal(discovery.split(scenario).length, 2, 'expected exactly one payment scenario');
    const exit = await child.run(config, 'execution.txt');
    assert.equal(exit, phase === 'broken' ? 1 : 0, 'unexpected payment test exit: ' + phase);
    const summary = verifyPaymentReport(
      JSON.parse(await readFile(join(directory, 'results.json'))),
      phase === 'broken',
    );
    const reportRoot = join(directory, 'output/blackbox-report');
    const scenarios = await readdir(reportRoot);
    assert.equal(scenarios.length, 1, 'expected one retained Blackbox report');
    const attemptRoot = join(reportRoot, scenarios[0]);
    const attempts = await readdir(attemptRoot);
    assert.equal(attempts.length, 1, 'expected one physical payment attempt report');
    assert.match(attempts[0], /^retry-0-worker-\d+$/u);
    const reportDirectory = join(attemptRoot, attempts[0]);
    assert.equal(digest(await readFile(join(reportDirectory, 'report.json'))), summary.report.jsonDigest);
    assert.equal(digest(await readFile(join(reportDirectory, 'report.html'))), summary.report.htmlDigest);
    assert.equal(digest(await readFile(contractPath)), hashes.contract);
    assert.equal(digest(await readFile(snapshotPath)), hashes.snapshot);
    const receipt = { phase, exit, inputs, ...summary };
    await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
    receipts.push(receipt);
    assert.ok(!interrupted, 'payment journey interrupted');
  }
} finally {
  process.off('SIGTERM', interrupt);
  process.off('SIGINT', interrupt);
  await writeFile(sourcePath, original);
}
assert.equal(receipts[0].inputs.implementation, receipts[2].inputs.implementation);
assert.notEqual(receipts[0].inputs.implementation, receipts[1].inputs.implementation);
for (const key of ['sandboxId', 'executionId', 'sessionId'])
  assert.equal(new Set(receipts.map((r) => r[key])).size, 3);
await writeFile(
  join(results, 'receipt.json'),
  JSON.stringify({ scenario, runs: receipts }, null, 2),
);
