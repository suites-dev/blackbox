import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'capsule-poll-progress.fixture.sh');

void test('shows the current shared-state condition, elapsed time, and bound', async () => {
  const result = await execute('bash', [fixture]);
  assert.equal(
    result.stdout,
    '[blackbox] Shared-state proof: waiting for separate consumer -> public-api trace · 3s / 15s\n',
  );
});
