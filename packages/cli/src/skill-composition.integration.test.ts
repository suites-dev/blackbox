import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

void test('composes selected package skills through the real CLI lifecycle', async () => {
  const packageDirectory = process.env.BLACKBOX_CLI_TEST_PACKAGE_DIRECTORY;
  if (packageDirectory === undefined) {
    throw new Error('BLACKBOX_CLI_TEST_PACKAGE_DIRECTORY is required');
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    [join(packageDirectory, 'bin/run.js'), 'skills', 'list', '--json'],
    { cwd: packageDirectory, encoding: 'utf8' },
  );

  assert.deepEqual(JSON.parse(stdout), {
    kind: 'skill-list',
    skills: [
      { name: 'capsule', dependencies: [], integrations: [] },
      { name: 'catalog', dependencies: [], integrations: [] },
      {
        name: 'discovery',
        dependencies: [],
        integrations: [
          { name: 'catalog', available: true },
          { name: 'capsule', available: true },
        ],
      },
    ],
  });
});
