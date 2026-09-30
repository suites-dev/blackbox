import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const filter = resolve(dirname(fileURLToPath(import.meta.url)), 'capsule-redis-execution.jq');

function execution(stdout) {
  return {
    kind: 'capsule-exec-completed',
    outcome: {
      kind: 'driver-completed',
      propagation: {
        expectation: { kind: 'shared-state-propagation-unsupported', resource: 'redis' },
        outcome: { kind: 'context-not-supported', boundary: 'shared-state', resource: 'redis' },
      },
      process: {
        kind: 'exited',
        exitCode: 0,
        stdout,
        location: { kind: 'participant', participantId: 'redis' },
      },
    },
  };
}

async function jqStatus(path) {
  try {
    await execute('jq', ['-e', '-f', filter, path]);
    return 0;
  } catch (error) {
    assert.equal(typeof error.code, 'number');
    return error.code;
  }
}

void test('accepts the literal redis-cli first-push stdout with its trailing newline', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-redis-execution-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const valid = join(directory, 'valid.json');
  const invalid = join(directory, 'invalid.json');
  await writeFile(valid, JSON.stringify(execution('1\n')));
  await writeFile(invalid, JSON.stringify(execution('2\n')));
  assert.equal(await jqStatus(valid), 0);
  assert.notEqual(await jqStatus(invalid), 0);
});
