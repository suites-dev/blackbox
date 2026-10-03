import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const packageName = '@suites/blackbox-effects';
export const digest = (value) => createHash('sha256').update(value).digest('hex');

export async function save(directory, name, value) {
  await writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function isolatedEnvironment(temporaryDirectory) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.toLowerCase().startsWith('npm_config_')) delete env[name];
  }
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return {
    ...env,
    TMPDIR: temporaryDirectory,
    npm_config_cache: join(temporaryDirectory, 'npm-cache'),
    npm_config_userconfig: join(temporaryDirectory, 'empty.npmrc'),
    npm_config_offline: 'true',
    npm_config_ignore_scripts: 'true',
  };
}

export function commandRecorder(evidence, env) {
  const commands = [];
  return async function command(name, executable, args, cwd, allowFailure = false) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(executable, args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    await writeFile(join(evidence, `${name}.log`), output);
    commands.push({
      name,
      command: [executable, ...args],
      cwd,
      startedAt,
      endedAt: new Date().toISOString(),
      exit: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
    });
    await save(evidence, 'commands.json', commands);
    if (!allowFailure && result.status !== 0) {
      throw new Error(`${name} exited ${result.status}; see ${join(evidence, `${name}.log`)}`);
    }
    return { ...result, output };
  };
}

export async function pack(input) {
  const destination = join(input.temporary, `tarballs-${input.name}`);
  await mkdir(destination);
  const result = await input.command(
    `${input.name}-pack`,
    'npm',
    ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', destination],
    input.directory,
  );
  const [metadata] = JSON.parse(result.stdout);
  assert.equal(metadata.name, packageName);
  const tarball = join(destination, metadata.filename);
  const data = await readFile(tarball);
  await cp(tarball, join(input.evidence, `${input.name}.tgz`));
  await save(input.evidence, `${input.name}-package.json`, {
    ...metadata,
    archiveSHA256: digest(data),
  });
  return { tarball, metadata };
}

export async function install(input) {
  const directory = join(input.temporary, `consumer-${input.name}`);
  await mkdir(directory);
  await cp(input.fixture, directory, { recursive: true });
  await save(directory, 'package.json', {
    name: `effects-packed-consumer-${input.name}`,
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies: { [packageName]: `file:${input.tarball}` },
  });
  await input.command(
    `${input.name}-install`,
    'npm',
    ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
    directory,
  );
  const installed = join(directory, 'node_modules', packageName);
  assert.equal((await lstat(installed)).isSymbolicLink(), false);
  assert.ok((await realpath(installed)).startsWith(`${await realpath(directory)}${sep}`));
  async function rejectLinks(parent) {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, `Installed package link: ${entry.name}`);
      if (entry.isDirectory()) await rejectLinks(join(parent, entry.name));
    }
  }
  await rejectLinks(installed);
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  assert.deepEqual(Object.keys(lock.packages[''].dependencies), [packageName]);
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', `node_modules/${packageName}`]);
  assert.equal(lock.packages[`node_modules/${packageName}`].integrity, input.metadata.integrity);
  for (const record of Object.values(lock.packages)) assert.notEqual(record.link, true);
  await save(input.evidence, `${input.name}-installation.json`, lock);
  return { directory, installed };
}

export async function treeHashes(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      assert.equal(entry.isSymbolicLink(), false, `Unexpected symlink: ${entry.name}`);
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else result[relative(root, file)] = digest(await readFile(file));
    }
  }
  await visit(root);
  return result;
}
