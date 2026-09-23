import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { collectEvidence, runCommand } from './ci-evidence.mjs';
import { retainE2eEvidence } from './e2e-evidence.mjs';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blackbox-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function write(root, relative, data) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

test('real tar retains hidden run files and colon filenames byte-for-byte after a failed test', async (t) => {
  const root = await workspace(t);
  const files = {
    'e2e/.blackbox/runs/exact-run/artifacts/spec.ts:19-pw-otel.zip': Buffer.from([0, 255, 10, 42]),
    'e2e/test-results/.hidden/trace:worker-1.zip': Buffer.from('trace bytes'),
    'e2e/test-results/junit.xml': Buffer.from('<testsuites/>'),
    'e2e/test-results/results.json': Buffer.from('{"status":"failed"}'),
  };
  for (const [name, bytes] of Object.entries(files)) await write(root, name, bytes);
  const receipt = await retainE2eEvidence({ root, testOutcome: 'failure' });
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.testOutcome, 'failure');
  assert.equal(receipt.productExecutionIds, null);
  const extracted = path.join(root, 'extracted');
  await fs.mkdir(extracted);
  const result = spawnSync('tar', [
    '-xf',
    path.join(root, '.blackbox/tmp/ci-e2e-transport/evidence.tar'),
    '-C',
    extracted,
  ]);
  assert.equal(result.status, 0, result.stderr.toString());
  for (const [name, bytes] of Object.entries(files)) {
    assert.deepEqual(await fs.readFile(path.join(extracted, name)), bytes);
    assert.deepEqual(await fs.readFile(path.join(root, name)), bytes);
    assert.match(receipt.entries.find((entry) => entry.path === name).sha256, /^[a-f0-9]{64}$/);
  }
});

test('failure before execution records absent outputs without inventing identities', async (t) => {
  const root = await workspace(t);
  const receipt = await retainE2eEvidence({ root, testOutcome: 'skipped' });
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.productExecutionIds, null);
  assert.equal(receipt.productConformance, false);
  assert.ok(receipt.sources.every((source) => source.status === 'missing'));
});

test('missing mandatory reports fail retention but preserve available evidence and receipt', async (t) => {
  const root = await workspace(t);
  await write(root, 'e2e/test-results/partial:trace.zip', 'partial');
  const receipt = await retainE2eEvidence({ root, testOutcome: 'failure' });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /Missing required Playwright reports/);
  assert.ok(receipt.archive.sha256);
  assert.equal(
    JSON.parse(
      await fs.readFile(
        path.join(root, '.blackbox/tmp/ci-e2e-transport/transport-receipt.json'),
        'utf8',
      ),
    ).status,
    'failed',
  );
});

test('archive spawn failure is retained as failure with command diagnostics', async (t) => {
  const root = await workspace(t);
  const receipt = await retainE2eEvidence({ root, tarCommand: path.join(root, 'missing-tar') });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.archive, null);
  assert.match(
    await fs.readFile(path.join(root, '.blackbox/tmp/ci-e2e-transport/archive.log'), 'utf8'),
    /ENOENT/,
  );
});

test('prior output is never overwritten', async (t) => {
  const root = await workspace(t);
  await retainE2eEvidence({ root });
  const target = path.join(root, '.blackbox/tmp/ci-e2e-transport/transport-receipt.json');
  const before = await fs.readFile(target);
  await assert.rejects(retainE2eEvidence({ root }), /EEXIST/);
  assert.deepEqual(await fs.readFile(target), before);
});

test('source symlinks are not followed into unrelated files', async (t) => {
  const root = await workspace(t);
  await fs.mkdir(path.join(root, 'e2e'), { recursive: true });
  await fs.symlink(os.tmpdir(), path.join(root, 'e2e/test-results'));
  const receipt = await retainE2eEvidence({ root });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /symlinks/);
});

test('output cannot escape the root or overlap a source', async (t) => {
  const root = await workspace(t);
  await assert.rejects(retainE2eEvidence({ root, outputDir: '../outside' }), /root-contained/);
  await assert.rejects(
    retainE2eEvidence({ root, outputDir: 'e2e/test-results/archive' }),
    /inside an evidence source/,
  );
});

test('generic collection retains a failed command and the portable archive together', async (t) => {
  const root = await workspace(t);
  await write(root, 'e2e/test-results/junit.xml', '<testsuites failures="1"/>');
  await write(root, 'e2e/test-results/results.json', '{"status":"failed"}');
  await write(root, 'e2e/.blackbox/runs/exact/trace:1.zip', 'retained');
  const evidenceDir = 'ci-evidence/e2e/legacy-harness';
  const sink = () =>
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
  const command = await runCommand(
    {
      rootDir: root,
      lane: 'e2e',
      project: 'legacy-harness',
      evidenceDir,
      command: [process.execPath, '-e', 'console.error("original failure"); process.exit(7)'],
    },
    { stdout: sink(), stderr: sink() },
  );
  assert.equal(command.exit_code, 7);
  assert.equal((await retainE2eEvidence({ root, testOutcome: 'failure' })).status, 'complete');
  const collectionInput = {
    rootDir: root,
    lane: 'e2e',
    project: 'legacy-harness',
    evidenceDir,
    expected: [
      `log=${evidenceDir}/logs/command.log`,
      'archive=.blackbox/tmp/ci-e2e-transport/evidence.tar',
      'transport=.blackbox/tmp/ci-e2e-transport/transport-receipt.json',
    ],
  };
  const collected = await collectEvidence(collectionInput);
  assert.equal(collected.receipt.result, 'failed');
  assert.equal(collected.receipt.exit_code, 7);
  assert.equal(collected.receipt.collection.status, 'complete');
  assert.match(
    await fs.readFile(path.join(root, evidenceDir, 'logs/command.log'), 'utf8'),
    /original failure/,
  );
  assert.ok((await fs.stat(path.join(root, evidenceDir, 'outputs/evidence.tar'))).size > 0);
  assert.ok(
    collected.inventory.expected.some(
      (entry) => entry.kind === 'log' && entry.required && entry.status === 'present',
    ),
  );
  const logPath = path.join(root, evidenceDir, 'logs/command.log');
  await fs.writeFile(logPath, '');
  await assert.rejects(collectEvidence(collectionInput), /Required CI evidence is incomplete/);
  await fs.unlink(logPath);
  await assert.rejects(collectEvidence(collectionInput), /Required CI evidence is incomplete/);
});

test('files modified during archiving cannot produce a successful transport receipt', async (t) => {
  const root = await workspace(t);
  await write(root, 'e2e/test-results/trace.zip', 'original');
  const wrapper = path.join(root, 'changing-tar');
  await fs.writeFile(
    wrapper,
    `#!${process.execPath}\nconst {spawnSync}=require('node:child_process');\nconst fs=require('node:fs');\nconst result=spawnSync('tar',process.argv.slice(2));\nfs.writeFileSync('e2e/test-results/trace.zip','changed');\nprocess.exit(result.status ?? 1);\n`,
    { mode: 0o700 },
  );
  const receipt = await retainE2eEvidence({ root, tarCommand: wrapper });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /changed during archiving/);
  assert.equal(receipt.archive, null);
});
