import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const packageDirectory = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const cliPackageDirectory = join(packageDirectory, '..', 'cli');
const output = await mkdtemp(join(tmpdir(), `blackbox-capsule-tests-${process.pid}-`));
const signals = { SIGINT: 130, SIGTERM: 143 };
let interrupted = 0;
let currentChild;

function interrupt(signal) {
  interrupted = signals[signal];
  if (currentChild?.pid === undefined) return;
  if (process.platform === 'win32') currentChild.kill(signal);
  else {
    try {
      process.kill(-currentChild.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
}

const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);

function run(command, args) {
  if (interrupted !== 0) return Promise.resolve(interrupted);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageDirectory,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: { ...process.env, BLACKBOX_CLI_TEST_PACKAGE_DIRECTORY: cliPackageDirectory },
    });
    currentChild = child;
    child.once('error', reject);
    child.once('close', (code) => {
      currentChild = undefined;
      resolve(interrupted !== 0 ? interrupted : (code ?? 1));
    });
  });
}

async function testsIn(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await testsIn(target)));
    else if (entry.name.endsWith('.test.js')) paths.push(target);
  }
  return paths.sort();
}

try {
  const build = await run('pnpm', ['build']);
  if (build !== 0) process.exitCode = build;
  else {
    const vitest = await run('pnpm', [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.config.ts',
      '--configLoader',
      'runner',
      '--exclude',
      'src/cli/**/*.test.ts',
    ]);
    if (vitest !== 0) process.exitCode = vitest;
    else {
      await symlink(join(packageDirectory, 'node_modules'), join(output, 'node_modules'), 'dir');
      await symlink(join(packageDirectory, 'dist'), join(output, 'dist'), 'dir');
      const packageManifest = await readFile(join(packageDirectory, 'package.json'), 'utf8');
      await writeFile(join(output, 'package.json'), packageManifest);
      const compile = await run('pnpm', [
        'exec',
        'tsc',
        '--project',
        'tsconfig.test.json',
        '--outDir',
        output,
      ]);
      if (compile !== 0) process.exitCode = compile;
      else {
        const tests = await testsIn(join(output, 'cli'));
        if (tests.length === 0) throw new Error('No emitted Capsule CLI tests were found');
        process.exitCode = await run(process.execPath, ['--test', ...tests]);
      }
    }
  }
} finally {
  await rm(output, { recursive: true, force: true });
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
}
