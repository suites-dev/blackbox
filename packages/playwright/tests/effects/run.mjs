import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeInstrumentationFiles } from '@suites/blackbox-inst-runtime-node';

import { recoverResults } from './cleanup.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(directory, '../../../../.blackbox/tmp');
await mkdir(output, { recursive: true });
const retained = await mkdtemp(join(output, 'playwright-effects.'));
const project = await mkdtemp(join(tmpdir(), 'blackbox-effects-tests.'));
const results = join(retained, 'results');

async function command(executable, args, environment = {}) {
  const child = spawn(executable, args, {
    cwd: directory,
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
  const interrupt = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await new Promise((resolveCommand, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolveCommand();
        else reject(new Error(`${executable} exited with ${signal ?? code}`));
      });
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

try {
  await cp(join(directory, 'project'), project, { recursive: true });
  const instrumentation = join(project, '.blackbox', 'instrumentation');
  await mkdir(instrumentation, { recursive: true });
  for (const file of nodeInstrumentationFiles) {
    await writeFile(join(instrumentation, file.name), file.content);
  }
  await command('npm', [
    'install',
    '--prefix',
    instrumentation,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    process.env.BLACKBOX_TEST_REGISTRY ?? 'https://registry.npmjs.org/',
  ]);
  await command(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve('@playwright/test/cli')),
      'test',
      '--config',
      join(directory, 'playwright.config.ts'),
      ...process.argv.slice(2),
    ],
    {
      BLACKBOX_EFFECTS_TEST_PROJECT: project,
      BLACKBOX_EFFECTS_TEST_RESULTS: results,
    },
  );
} finally {
  await recoverResults(results);
  await rm(project, { recursive: true, force: true });
  process.stdout.write(`Effects integration results: ${results}\n`);
}
