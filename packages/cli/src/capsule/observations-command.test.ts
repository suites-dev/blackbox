import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from './reporting/capsule-command.fixture.js';
import {
  ACTIVITY_A,
  CAPSULE_A,
  TRACE_A,
  twoCapsuleProject,
} from '../testing/surface/project.fixture.js';

void test('observations selects exact session, activity, and trace reads', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const selections = [
      {
        argv: ['observations', '--session', CAPSULE_A, '--json'],
        kind: 'collector-session-missing',
      },
      {
        argv: ['observations', '--session', CAPSULE_A, '--activity', ACTIVITY_A, '--json'],
        kind: 'collector-activity-missing',
      },
      {
        argv: ['observations', '--session', CAPSULE_A, '--trace', TRACE_A, '--json'],
        kind: 'collector-trace-missing',
      },
    ] as const;
    for (const selection of selections) {
      const result = await runCli({ directory: fixture.directory, argv: selection.argv });
      assert.equal(result.status, 0, result.stderr);
      const document = JSON.parse(result.stdout);
      assert.equal(document.kind, selection.kind);
      assert.equal(document.capsule, CAPSULE_A);
    }
  } finally {
    await fixture.remove();
  }
});

void test('observations resolves IDs like show: an ID that is not retained is id-unknown', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['observations', '--session', CAPSULE_A, '--activity', 'activity-1', '--json'],
    });
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      kind: 'cli-error',
      code: 'id-unknown',
      message: 'no capsule, activity or trace matches activity-1',
      next: ['blackbox ls --all'],
    });
  } finally {
    await fixture.remove();
  }
});

void test('observations for an unknown session keeps the capsule-not-found document', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['observations', '--session', 'quiet-river-ada-000000000009', '--json'],
    });
    assert.equal(result.status, 125);
    assert.equal(JSON.parse(result.stdout).kind, 'capsule-not-found');
    assert.equal(result.stderr, '');
  } finally {
    await fixture.remove();
  }
});

void test('observations rejects simultaneous activity and trace selectors', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: ['observations', '--session', CAPSULE_A, '--activity', ACTIVITY_A, '--trace', TRACE_A],
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^blackbox: --activity and --trace cannot be used together\n/u);
  } finally {
    await fixture.remove();
  }
});
