import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspacePath = resolve(scriptDirectory, '..', '..');
// The consumer is shared: the demo and the CLI journeys prepare it against the
// same project, and e2e is the only one in this repository.
const projectRoot = join(workspacePath, 'e2e');
const statePath = join(projectRoot, '.blackbox', 'capsule-assets.json');
async function canonical(path) {
  return resolve(await realpath(path));
}

async function readState() {
  const value = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.assetRoot !== 'string' ||
    typeof value.consumerRoot !== 'string' ||
    typeof value.blackboxBin !== 'string' ||
    typeof value.driverDirectory !== 'string'
  ) {
    throw new Error(`Invalid Capsule asset state: ${statePath}`);
  }
  const assetName = basename(value.assetRoot);
  if (!/^blackbox-capsule-assets\.[A-Za-z0-9]+$/u.test(assetName)) {
    throw new Error(`Invalid Capsule asset root identity: ${assetName}`);
  }
  const assetRoot = join(tmpdir(), assetName);
  const consumerRoot = join(assetRoot, 'consumer');
  const blackboxBin = join(consumerRoot, 'node_modules', '.bin', 'blackbox');
  const driverDirectory = join(projectRoot, '.blackbox', 'drivers');
  if (
    resolve(value.assetRoot) !== resolve(assetRoot) ||
    resolve(value.consumerRoot) !== resolve(consumerRoot) ||
    resolve(value.blackboxBin) !== resolve(blackboxBin) ||
    resolve(value.driverDirectory) !== resolve(driverDirectory)
  ) {
    throw new Error('Capsule asset state does not match the fixed E2E asset layout.');
  }
  return { assetRoot, consumerRoot, blackboxBin, driverDirectory };
}

export async function cleanupCapsuleAssets() {
  let state;
  try {
    state = await readState();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  const parent = await canonical(dirname(state.assetRoot));
  const temporaryRoot = await canonical(tmpdir());
  if (
    parent !== temporaryRoot ||
    !/^blackbox-capsule-assets\.[A-Za-z0-9]+$/u.test(basename(state.assetRoot))
  ) {
    throw new Error(`Refusing to clean an unowned Capsule asset path: ${state.assetRoot}`);
  }
  let info;
  try {
    info = await lstat(state.assetRoot);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      await rm(statePath, { force: true });
      return;
    }
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing to clean a non-directory Capsule asset path: ${state.assetRoot}`);
  }
  await rm(state.assetRoot, { recursive: true, force: true });
  await rm(statePath, { force: true });
}
