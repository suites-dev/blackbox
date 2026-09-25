import { constants } from 'node:fs';
import { access, lstat, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

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

async function readState(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
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
    throw new Error(`Invalid Capsule asset state: ${path}`);
  }
  return value;
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

async function verify(statePath, workspacePath) {
  const state = await readState(statePath);
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

  process.stdout.write(
    `${JSON.stringify(
      {
        kind: 'capsule-packed-asset-boundary',
        assetRoot,
        consumerRoot,
        blackboxBin,
        driverSdk,
        drivers,
        packages,
      },
      null,
      2,
    )}\n`,
  );
}

async function cleanup(statePath) {
  let state;
  try {
    state = await readState(statePath);
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

const [operation, statePath, workspacePath] = process.argv.slice(2);
if (operation === 'verify' && statePath !== undefined && workspacePath !== undefined) {
  await verify(resolve(statePath), resolve(workspacePath));
} else if (operation === 'cleanup' && statePath !== undefined) {
  await cleanup(resolve(statePath));
} else {
  throw new Error('Usage: capsule-asset-boundary.mjs <verify state workspace|cleanup state>');
}
