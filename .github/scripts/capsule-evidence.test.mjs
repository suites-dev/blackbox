import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { retainE2eEvidence } from './e2e-evidence.mjs';

const sessionId = 'bright-river-ada';
const experiment = `e2e/.blackbox/experiments/capsule-${sessionId}`;
const runtime = 'e2e/.blackbox/tmp/capsule-test.ABC123';

async function write(root, name, value) {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), value);
}

async function fixture(context) {
  const root = await mkdtemp(path.join(tmpdir(), 'bb-capsule-evidence-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    [`${experiment}/session.json`]: JSON.stringify({ sessionId, state: 'stopped' }),
    [`${experiment}/activities.json`]: '[]',
    [`${experiment}/progress.json`]: '[]',
    [`${runtime}/receipt.txt`]: `session=${sessionId}\n`,
    [`${runtime}/capsule-start.json`]: JSON.stringify({ sessionId }),
    [`${runtime}/capsule-stop.json`]: JSON.stringify({ sessionId, cleanup: 'complete' }),
    [`${runtime}/capsule-report.json`]: '{}',
    [`${runtime}/served-stopped.json`]: '{}',
    [`${runtime}/served-reopened.json`]: '{}',
    [`e2e/.blackbox/reports/capsule-${sessionId}/capsule-report.html`]: '<html>Capsule</html>',
  };
  for (const [name, bytes] of Object.entries(files)) await write(root, name, bytes);
  return { root, files };
}

test('Capsule transport retains exact experiment bytes and allowlisted receipts without arbitrary tmp data', async (context) => {
  const { root, files } = await fixture(context);
  await write(root, `${runtime}/private-token.txt`, 'never archive this');
  await write(root, 'e2e/.blackbox/tmp/unrelated/receipt.txt', 'unrelated');
  await write(root, 'e2e/.blackbox/runs/legacy/private.json', 'old');
  const receipt = await retainE2eEvidence({ root, project: 'capsule', testOutcome: 'success' });
  assert.equal(receipt.status, 'complete', receipt.error);
  assert.equal(receipt.productConformance, false);
  assert.equal(receipt.productExecutionIds, null);
  const archive = path.join(root, '.blackbox/tmp/ci-e2e-transport/evidence.tar');
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  assert.doesNotMatch(listing.stdout, /private-token|unrelated|legacy/u);
  for (const [name, bytes] of Object.entries(files)) {
    const retained = spawnSync('tar', ['-xOf', archive, `./${name}`], { encoding: 'utf8' });
    assert.equal(retained.status, 0, retained.stderr);
    assert.equal(retained.stdout, bytes);
    assert.equal(await readFile(path.join(root, name), 'utf8'), bytes);
  }
});

test('successful Capsule status cannot hide missing exact-session records', async (context) => {
  const { root } = await fixture(context);
  await rm(path.join(root, experiment, 'progress.json'));
  const receipt = await retainE2eEvidence({ root, project: 'capsule', testOutcome: 'success' });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /Missing required Capsule evidence.*progress\.json/u);
  assert.ok(receipt.archive.sha256);
});

test('a failed Capsule command retains partial startup and cleanup receipts without requiring success artifacts', async (context) => {
  const { root } = await fixture(context);
  await rm(path.join(root, runtime, 'receipt.txt'));
  await rm(path.join(root, experiment, 'activities.json'));
  await write(root, `${runtime}/cleanup-stop.json`, '{"cleanup":"failed"}');
  const receipt = await retainE2eEvidence({ root, project: 'capsule', testOutcome: 'failure' });
  assert.equal(receipt.status, 'complete', receipt.error);
  assert.equal(receipt.testOutcome, 'failure');
  assert.ok(receipt.entries.some((entry) => entry.path === `${runtime}/cleanup-stop.json`));
});

test('a missing journey receipt prevents successful Capsule evidence acceptance', async (context) => {
  const { root } = await fixture(context);
  await rm(path.join(root, runtime, 'receipt.txt'));
  const receipt = await retainE2eEvidence({ root, project: 'capsule', testOutcome: 'success' });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.error, /exactly one nonempty journey receipt/u);
});

test('allowlisted receipt names cannot smuggle directories or symlink targets into the archive', async (context) => {
  for (const kind of ['directory', 'symlink']) {
    const { root } = await fixture(context);
    const target = path.join(root, runtime, 'receipt.txt');
    await rm(target);
    if (kind === 'directory') {
      await mkdir(target);
      await writeFile(path.join(target, 'secret'), 'hidden');
    } else {
      await write(root, 'foreign.txt', 'hidden');
      await symlink(path.join(root, 'foreign.txt'), target);
    }
    const receipt = await retainE2eEvidence({ root, project: 'capsule', testOutcome: 'failure' });
    assert.equal(receipt.status, 'failed');
    assert.match(receipt.error, /regular file|symlink/u);
  }
});
