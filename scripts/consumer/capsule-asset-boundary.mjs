import { constants } from 'node:fs';
import { access, lstat, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspacePath = resolve(scriptDirectory, '..', '..');
// The consumer is shared: the demo and the CLI journeys prepare it against the
// same project, and e2e is the only one in this repository.
const projectRoot = join(workspacePath, 'e2e');
const statePath = join(projectRoot, '.blackbox', 'capsule-assets.json');
const packedPackages = [
  '@suites/blackbox-capsule',
  '@suites/blackbox-catalog',
  '@suites/blackbox-cli',
  '@suites/blackbox-cli-contract',
  '@suites/blackbox-discovery',
  '@suites/blackbox-driver',
  '@suites/blackbox-inst-runtime-node',
  '@suites/blackbox-instrumentation',
  '@suites/blackbox-otel-collector',
  '@suites/blackbox-playwright',
  '@suites/blackbox-report-server',
  '@suites/blackbox-sandbox',
  '@suites/blackbox-skills',
  '@suites/blackbox-telemetry',
];

function isWithin(path, root) {
  const difference = relative(root, path);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

async function canonical(path) {
  return resolve(await realpath(path));
}

function assertWithin(path, root, label) {
  if (!isWithin(path, root)) {
    throw new Error(`${label} escaped its owned directory: ${path}`);
  }
}

function assertOutside(path, root, label) {
  if (isWithin(path, root)) {
    throw new Error(`${label} resolved through the workspace: ${path}`);
  }
}

async function readState() {
  const value = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.assetRoot !== 'string' ||
    typeof value.consumerRoot !== 'string' ||
    typeof value.blackboxBin !== 'string' ||
    typeof value.driverDirectory !== 'string' ||
    !Array.isArray(value.packages) ||
    !value.packages.every((name) => typeof name === 'string')
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
  const actualPackages = [...value.packages].sort();
  if (
    resolve(value.assetRoot) !== resolve(assetRoot) ||
    resolve(value.consumerRoot) !== resolve(consumerRoot) ||
    resolve(value.blackboxBin) !== resolve(blackboxBin) ||
    resolve(value.driverDirectory) !== resolve(driverDirectory) ||
    JSON.stringify(actualPackages) !== JSON.stringify([...packedPackages].sort())
  ) {
    throw new Error('Capsule asset state does not match the fixed E2E asset layout.');
  }
  return { assetRoot, consumerRoot, blackboxBin, driverDirectory, packages: packedPackages };
}

async function verifyPackage(input) {
  const packagePath = join(input.consumerRoot, 'node_modules', ...input.name.split('/'));
  const resolvedPackage = await canonical(packagePath);
  assertWithin(resolvedPackage, input.consumerRoot, input.name);
  assertOutside(resolvedPackage, input.workspaceRoot, input.name);
  const document = JSON.parse(await readFile(join(resolvedPackage, 'package.json'), 'utf8'));
  if (document.name !== input.name) {
    throw new Error(`Packed package identity mismatch: ${input.name}`);
  }
  const require = createRequire(join(input.consumerRoot, 'asset-boundary.cjs'));
  let resolvedEntrypoint;
  try {
    resolvedEntrypoint = require.resolve(input.name);
  } catch (error) {
    const binaries =
      document.bin === undefined
        ? []
        : typeof document.bin === 'string'
          ? [document.bin]
          : Object.values(document.bin);
    if (
      !(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      ) ||
      binaries.length !== 1 ||
      typeof binaries[0] !== 'string'
    ) {
      throw error;
    }
    resolvedEntrypoint = join(resolvedPackage, binaries[0]);
  }
  const entrypoint = await canonical(resolvedEntrypoint);
  assertWithin(entrypoint, input.consumerRoot, `${input.name} entrypoint`);
  assertOutside(entrypoint, input.workspaceRoot, `${input.name} entrypoint`);
  return { name: input.name, packageRoot: resolvedPackage, entrypoint };
}

export async function verifyCapsuleAssetBoundary() {
  const state = await readState();
  const workspaceRoot = await canonical(workspacePath);
  const assetRoot = await canonical(state.assetRoot);
  const consumerRoot = await canonical(state.consumerRoot);
  const blackboxBin = await canonical(state.blackboxBin);
  const driverDirectory = await canonical(state.driverDirectory);
  assertOutside(assetRoot, workspaceRoot, 'asset root');
  assertWithin(consumerRoot, assetRoot, 'packed consumer');
  assertWithin(blackboxBin, consumerRoot, 'blackbox executable');
  assertOutside(blackboxBin, workspaceRoot, 'blackbox executable');
  await access(blackboxBin, constants.X_OK);

  const packages = [];
  for (const name of state.packages) {
    packages.push(await verifyPackage({ consumerRoot, name, workspaceRoot }));
  }

  const drivers = [];
  for (const name of ['postgres.mjs', 'public-api.mjs', 'redis.mjs']) {
    const path = await canonical(join(driverDirectory, name));
    const driverRequire = createRequire(path);
    const driverSdk = await canonical(driverRequire.resolve('@suites/blackbox-driver'));
    assertWithin(driverSdk, driverDirectory, `${name} Driver SDK`);
    assertOutside(driverSdk, join(workspaceRoot, 'packages'), `${name} Driver SDK`);
    drivers.push({ name, path, driverSdk });
  }
  const driverSdk = drivers[0].driverSdk;
  if (!drivers.every((driver) => driver.driverSdk === driverSdk)) {
    throw new Error('Project drivers resolved different Driver SDK installations');
  }

  return {
    kind: 'capsule-registry-consumer-boundary',
    assetRoot,
    consumerRoot,
    blackboxBin,
    driverSdk,
    drivers,
    packages,
  };
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
