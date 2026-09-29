import assert from 'node:assert/strict';
import test from 'node:test';

import { ACTIVITY_A, CAPSULE_A, twoCapsuleProject } from './project.fixture.js';
import { cli, onlyDocument, run } from './run-cli.fixture.js';

const UNLISTED = 'quiet-river-ada-000000000009';
const MALFORMED = [
  '../../outside',
  `${CAPSULE_A}/../${CAPSULE_A}`,
  '/etc',
  'a'.repeat(4096),
] as const;

void test('an unlisted explicit capsule fails as capsule-not-found, with capsule and next, on every command', async () => {
  const fixture = await twoCapsuleProject();
  try {
    // report has no --capsule flag; BLACKBOX_CAPSULE is its explicit context.
    for (const [argv, capsuleEnvironment] of [
      [['run', '--capsule', UNLISTED, '--json', '--', 'x'], null],
      [['down', '--capsule', UNLISTED, '--json'], null],
      [['report', '--json'], UNLISTED],
      [['show', ACTIVITY_A, '--capsule', UNLISTED, '--json'], null],
    ] as const) {
      const result = await cli({ directory: fixture.directory, argv, capsuleEnvironment });
      assert.equal(result.status, 125, argv.join(' '));
      assert.deepEqual(onlyDocument(result), {
        kind: 'capsule-not-found',
        sessionId: UNLISTED,
        message: `Capsule session ${UNLISTED} does not exist`,
        capsule: UNLISTED,
        next: ['blackbox ls --all'],
      });
    }
  } finally {
    await fixture.remove();
  }
});

void test('a malformed explicit capsule from a flag or BLACKBOX_CAPSULE is refused before any file access', async () => {
  const fixture = await twoCapsuleProject();
  try {
    for (const value of MALFORMED) {
      const fromFlag = await run(fixture.directory, 'run', '--capsule', value, '--json', '--', 'x');
      const fromEnvironment = await cli({
        directory: fixture.directory,
        argv: ['down', '--json'],
        capsuleEnvironment: value,
      });
      for (const [result, operation] of [
        [fromFlag, 'exec'],
        [fromEnvironment, 'stop'],
      ] as const) {
        assert.equal(result.status, 125);
        assert.deepEqual(onlyDocument(result), {
          kind: 'capsule-operation-failed',
          operation,
          sessionId: value,
          error: {
            name: 'Error',
            message: 'sessionId must be an exact Capsule-generated identity',
          },
          capsule: value,
          next: ['blackbox ls --all'],
        });
      }
    }
  } finally {
    await fixture.remove();
  }
});

void test('a positional capsule ID wins over stale explicit context; other IDs still require a listed context', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const fromEnvironment = await cli({
      directory: fixture.directory,
      argv: ['show', CAPSULE_A, '--json'],
      capsuleEnvironment: UNLISTED,
    });
    assert.equal(fromEnvironment.status, 0, fromEnvironment.stderr);
    assert.equal(onlyDocument(fromEnvironment).capsule, CAPSULE_A);
    const fromFlag = await run(
      fixture.directory,
      'show',
      CAPSULE_A,
      '--capsule',
      UNLISTED,
      '--json',
    );
    assert.equal(fromFlag.status, 0, fromFlag.stderr);
    assert.equal(onlyDocument(fromFlag).capsule, CAPSULE_A);
    const activity = await cli({
      directory: fixture.directory,
      argv: ['show', ACTIVITY_A, '--json'],
      capsuleEnvironment: UNLISTED,
    });
    assert.equal(activity.status, 125);
    assert.equal(onlyDocument(activity).kind, 'capsule-not-found');
  } finally {
    await fixture.remove();
  }
});

void test('a Capsule package failure keeps its document and adds capsule and next', async () => {
  const fixture = await twoCapsuleProject();
  try {
    // CAPSULE_A is listed as running, but no manager is listening on its socket.
    const result = await run(fixture.directory, 'run', '--capsule', CAPSULE_A, '--json', '--', 'x');
    assert.equal(result.status, 125);
    const document = onlyDocument(result);
    assert.equal(document.kind, 'capsule-operation-failed');
    assert.equal(document.sessionId, CAPSULE_A);
    assert.equal(document.capsule, CAPSULE_A);
    assert.deepEqual(document.next, []);
  } finally {
    await fixture.remove();
  }
});
