import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { capsuleSessionDirectory } from '@suites/blackbox-capsule';

import {
  ACTIVITY_A,
  CAPSULE_A,
  TRACE_A,
  fixtureActivity,
  projectFixture,
  twoCapsuleProject,
} from '../../../testing/surface/project.fixture.js';
import { capsule, cli, onlyDocument, run } from '../../../testing/surface/run-cli.fixture.js';

/** A well-formed trace ID that no capsule retains. */
const ABSENT_TRACE = 'cafecafecafecafecafecafecafecafe';
const STOPPED = 'still-harbor-eve-000000000003';

async function runningAndStopped() {
  return projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [fixtureActivity(ACTIVITY_A, TRACE_A, 'Create order')],
    },
    {
      sessionId: STOPPED,
      state: 'stopped',
      system: 'orders',
      admittedAt: '2026-01-02T00:00:00.000Z',
      activities: [],
    },
  ]);
}

const pendingLine = (capsule: string) =>
  `trace ${ABSENT_TRACE} · capsule ${capsule} · not observed yet · provisional (capsule running)\n` +
  `→ blackbox capsule show ${capsule} --timeline\n`;

void test('a trace not observed yet in an explicit, running capsule is provisional (exit 0)', async () => {
  const fixture = await runningAndStopped();
  try {
    const human = await capsule(fixture.directory, 'show', ABSENT_TRACE, '--session', CAPSULE_A);
    assert.equal(human.status, 0, human.stderr);
    assert.equal(human.stderr, pendingLine(CAPSULE_A));
    const json = await capsule(fixture.directory, 'show', ABSENT_TRACE, '--session', CAPSULE_A, '--json');
    const document = onlyDocument(json);
    assert.equal(json.status, 0);
    assert.equal(document.kind, 'collector-trace-missing');
    assert.equal(document.traceId, ABSENT_TRACE);
    assert.equal(document.capsule, CAPSULE_A);
    assert.equal(document.status, 'provisional');
    assert.deepEqual(document.next, [`blackbox capsule show ${CAPSULE_A} --timeline`]);
    const fromEnvironment = await cli({
      directory: fixture.directory,
      argv: ['capsule', 'show', ABSENT_TRACE],
      capsuleEnvironment: CAPSULE_A,
    });
    assert.equal(fromEnvironment.status, 0);
    assert.equal(fromEnvironment.stderr, pendingLine(CAPSULE_A));
    // The observations alias takes the same path.
    const alias = await run(fixture.directory, 'observations', '--session', CAPSULE_A, '--trace', ABSENT_TRACE);
    assert.equal(alias.status, 0);
    assert.equal(alias.stderr, pendingLine(CAPSULE_A));
  } finally {
    await fixture.remove();
  }
});

void test('a trace found nowhere stays id-unknown for a final capsule or without explicit context', async () => {
  const fixture = await runningAndStopped();
  try {
    for (const argv of [
      ['capsule', 'show', ABSENT_TRACE, '--session', STOPPED],
      ['observations', '--session', STOPPED, '--trace', ABSENT_TRACE],
      ['capsule', 'show', ABSENT_TRACE],
    ]) {
      const result = await run(fixture.directory, ...argv, '--json');
      assert.equal(result.status, 2, argv.join(' '));
      assert.equal(onlyDocument(result).code, 'id-unknown', argv.join(' '));
    }
    // The current capsule is implicit context: it never makes a trace provisional.
    assert.equal((await capsule(fixture.directory, 'use', CAPSULE_A)).status, 0);
    const implicit = await capsule(fixture.directory, 'show', ABSENT_TRACE, '--json');
    assert.equal(implicit.status, 2);
    assert.equal(onlyDocument(implicit).code, 'id-unknown');
    // A retained trace resolves exactly as before, with its status added.
    const found = onlyDocument(await capsule(fixture.directory, 'show', TRACE_A, '--json'));
    assert.equal(found.capsule, CAPSULE_A);
    assert.equal(found.status, 'provisional');
    assert.deepEqual(found.tree, []);
  } finally {
    await fixture.remove();
  }
});

void test('every new explicit-capsule path refuses a malformed capsule before any file access', async () => {
  const fixture = await twoCapsuleProject();
  try {
    for (const value of ['../../outside', `${CAPSULE_A}/../${CAPSULE_A}`]) {
      for (const [argv, capsuleEnvironment] of [
        [['capsule', 'show', ABSENT_TRACE, '--session', value, '--json'], null],
        [['capsule', 'show', ABSENT_TRACE, '--spans', '--json'], value],
        [['observations', '--session', value, '--trace', ABSENT_TRACE, '--json'], null],
        [['capsule', 'show', ACTIVITY_A, '--session', value, '--json'], null],
      ] as const) {
        const result = await cli({ directory: fixture.directory, argv, capsuleEnvironment });
        assert.equal(result.status, 125, `${argv.join(' ')} ${String(capsuleEnvironment)}`);
        assert.deepEqual(onlyDocument(result), {
          kind: 'capsule-operation-failed',
          operation: 'observations',
          sessionId: value,
          error: { name: 'Error', message: 'sessionId must be an exact Capsule-generated identity' },
          capsule: value,
          next: ['blackbox capsule ls --all'],
        });
      }
    }
  } finally {
    await fixture.remove();
  }
});

void test('show adds status, trees and limitations without changing phase 1 fields', async () => {
  const fixture = await runningAndStopped();
  try {
    const activity = onlyDocument(await capsule(fixture.directory, 'show', ACTIVITY_A, '--json'));
    assert.equal(activity.kind, 'collector-activity-missing');
    assert.equal(activity.activityId, ACTIVITY_A);
    assert.deepEqual(activity.context, { kind: 'untraced' });
    assert.deepEqual(activity.observation, {
      status: 'provisional',
      traces: [],
      services: [],
      spans: 0,
      tree: [],
      uncaused: [],
    });
    assert.deepEqual(activity.limitations, [{ kind: 'observation-provisional' }, { kind: 'untraced' }]);
    const capsuleDocument = onlyDocument(await capsule(fixture.directory, 'show', STOPPED, '--json'));
    assert.equal(capsuleDocument.kind, 'collector-session-missing');
    assert.equal(capsuleDocument.status, 'incomplete');
    assert.equal('timeline' in capsuleDocument, false);
    const timeline = onlyDocument(await capsule(fixture.directory, 'show', CAPSULE_A, '--timeline', '--json'));
    assert.equal(timeline.status, 'provisional');
    assert.deepEqual(timeline.timeline, [
      { offsetMs: 2000, activity: ACTIVITY_A, trace: null, marker: 'none' },
    ]);
    const human = await capsule(fixture.directory, 'show', CAPSULE_A, '--timeline');
    assert.equal(
      human.stderr,
      `capsule ${CAPSULE_A}  orders  running  · provisional (capsule running)\n` +
        '  +2.0s  3f9a2c41  stimulus  Create order  (no telemetry)\n' +
        `→ blackbox capsule show 3f9a2c41 --session ${CAPSULE_A}\n`,
    );
  } finally {
    await fixture.remove();
  }
});

void test('show never prints the activity argv, human or JSON', async () => {
  const secret = 'Bearer argv-secret-7f3a91';
  const fixture = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [
        {
          ...fixtureActivity(ACTIVITY_A, TRACE_A, 'Reset fixture'),
          argv: ['curl', '-H', `Authorization: ${secret}`, '/fixture/reset'],
        },
      ],
    },
  ]);
  try {
    for (const argv of [
      ['capsule', 'show', ACTIVITY_A],
      ['capsule', 'show', ACTIVITY_A, '--json'],
      ['capsule', 'show', TRACE_A],
      ['capsule', 'show', TRACE_A, '--spans', '--json'],
      ['capsule', 'show', CAPSULE_A, '--timeline'],
      ['capsule', 'show', CAPSULE_A, '--timeline', '--json'],
    ]) {
      const result = await run(fixture.directory, ...argv);
      assert.equal(result.status, 0, argv.join(' '));
      const output = result.stdout + result.stderr;
      assert.doesNotMatch(output, /argv-secret|Authorization|\/fixture\/reset|curl/u, argv.join(' '));
    }
    // Negative control: the secret really is in the record show reads.
    const record = await readFile(
      join(
        capsuleSessionDirectory({ projectDirectory: fixture.directory, sessionId: CAPSULE_A }),
        'activities.json',
      ),
      'utf8',
    );
    assert.match(record, /argv-secret/u);
  } finally {
    await fixture.remove();
  }
});
