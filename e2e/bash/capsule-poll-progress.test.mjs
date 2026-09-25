import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const progress = resolve(dirname(fileURLToPath(import.meta.url)), 'capsule-poll-progress.sh');

void test('shows the current shared-state condition, elapsed time, and bound', async () => {
  const script = `
set -Eeuo pipefail
INTERACTIVE=0
C_CYAN=''
C_RESET=''
source "$1"
render_poll_progress 3 15 'waiting for separate consumer -> public-api trace'
`;
  const result = await execute('bash', ['-c', script, 'progress-test', progress]);
  assert.equal(
    result.stdout,
    '[blackbox] Shared-state proof: waiting for separate consumer -> public-api trace · 3s / 15s\n',
  );
});
