import assert from 'node:assert/strict';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

async function fixture(context) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'blackbox-cleanup-tests.')));
  const assetRoot = await mkdtemp(join(tmpdir(), 'blackbox-capsule-assets.'));
  context.after(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(assetRoot, { recursive: true, force: true });
  });
  const scripts = join(workspace, 'scripts', 'consumer');
  const project = join(workspace, 'e2e');
  await mkdir(scripts, { recursive: true });
  await mkdir(join(project, '.blackbox'), { recursive: true });
  const modulePath = join(scripts, 'capsule-assets.mjs');
  await copyFile(new URL('./capsule-assets.mjs', import.meta.url), modulePath);
  const statePath = join(project, '.blackbox', 'capsule-assets.json');
  const state = {
    assetRoot,
    consumerRoot: join(assetRoot, 'consumer'),
    blackboxBin: join(assetRoot, 'consumer', 'node_modules', '.bin', 'blackbox'),
    driverDirectory: join(project, '.blackbox', 'drivers'),
  };
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(join(assetRoot, 'owned'), 'temporary consumer');
  const { cleanupCapsuleAssets } = await import(pathToFileURL(modulePath).href);
  return { assetRoot, workspace, state, statePath, cleanup: cleanupCapsuleAssets };
}

test('removes owned temporary assets and state while retaining other evidence', async (context) => {
  const input = await fixture(context);
  const golden = join(input.workspace, 'golden.txt');
  await writeFile(golden, 'retained evidence');
  await input.cleanup();
  await assert.rejects(lstat(input.assetRoot), { code: 'ENOENT' });
  await assert.rejects(lstat(input.statePath), { code: 'ENOENT' });
  assert.equal(await readFile(golden, 'utf8'), 'retained evidence');
  await input.cleanup();
});

test('rejects a foreign directory without deleting it or its ownership record', async (context) => {
  const input = await fixture(context);
  await writeFile(input.statePath, JSON.stringify({ ...input.state, assetRoot: input.workspace }));
  await assert.rejects(input.cleanup(), /Invalid Capsule asset root identity/);
  assert.equal(await readFile(join(input.assetRoot, 'owned'), 'utf8'), 'temporary consumer');
  assert.ok(await lstat(input.statePath));
});

test('rejects a substituted symlink without following it', async (context) => {
  const input = await fixture(context);
  const retained = join(input.workspace, 'retained');
  await mkdir(retained);
  await writeFile(join(retained, 'evidence'), 'keep');
  await rm(input.assetRoot, { recursive: true });
  await symlink(retained, input.assetRoot);
  await assert.rejects(input.cleanup(), /non-directory Capsule asset path/);
  assert.equal(await readFile(join(retained, 'evidence'), 'utf8'), 'keep');
  assert.ok(await lstat(input.statePath));
});
