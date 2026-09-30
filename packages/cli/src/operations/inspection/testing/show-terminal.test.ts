import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { capsuleSessionDirectory } from '@suites/blackbox-capsule';

import {
  ACTIVITY_A,
  CAPSULE_A,
  TRACE_A,
  fixtureActivity,
  projectFixture,
} from '../../../testing/surface/project.fixture.js';
import { capsule, onlyDocument } from '../../../testing/surface/run-cli.fixture.js';

const STOPPED = 'still-harbor-eve-000000000003';

/** Every control character other than the line feed that separates output lines. */
function controlCharacters(text: string): readonly number[] {
  const found: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code !== 10 && (code < 32 || (code >= 127 && code <= 159))) {
      found.push(code);
    }
  }
  return found;
}

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

void test('negative control: the oracle finds escape sequences and stray line breaks', () => {
  assert.deepEqual(controlCharacters('a\u001b[2Jb\rc\u0085d\ne'), [27, 13, 133]);
});

void test('show writes no control character or escape sequence from records to the terminal', async () => {
  const forged = 'Create order\u001b[2J\u001b]0;title\u0007\nactivity forged · capsule x';
  const fixture = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [fixtureActivity(ACTIVITY_A, TRACE_A, forged)],
    },
  ]);
  try {
    for (const argv of [
      ['show', ACTIVITY_A],
      ['show', CAPSULE_A, '--timeline'],
    ]) {
      const human = await capsule(fixture.directory, ...argv);
      assert.equal(human.status, 0, argv.join(' '));
      assert.deepEqual(controlCharacters(human.stderr), [], argv.join(' '));
      assert.doesNotMatch(human.stderr, /^activity forged/mu, argv.join(' '));
    }
    // JSON stays structured: the name is kept as recorded.
    const json = onlyDocument(
      await capsule(fixture.directory, 'show', CAPSULE_A, '--timeline', '--json'),
    );
    assert.equal(json.kind, 'collector-session-missing');
  } finally {
    await fixture.remove();
  }
});

void test('show --timeline refuses to build a timeline from an unreadable activity record', async () => {
  const fixture = await runningAndStopped();
  try {
    await writeFile(
      join(
        capsuleSessionDirectory({ projectDirectory: fixture.directory, sessionId: CAPSULE_A }),
        'activities.json',
      ),
      '{not-json',
    );
    const human = await capsule(fixture.directory, 'show', CAPSULE_A, '--timeline');
    assert.equal(human.status, 125);
    assert.match(human.stderr, /its activity record could not be read, so there is no timeline/u);
    assert.doesNotMatch(human.stderr, /no activity/u);
    const json = await capsule(fixture.directory, 'show', CAPSULE_A, '--timeline', '--json');
    assert.equal(json.status, 125);
    const document = onlyDocument(json);
    assert.equal(document.kind, 'cli-error');
    assert.equal(document.code, 'operation-failed');
    assert.deepEqual(document.next, [`blackbox capsule show ${CAPSULE_A}`]);
    // Negative control: the plain capsule view still reports the unknown count.
    const plain = await capsule(fixture.directory, 'show', CAPSULE_A);
    assert.equal(plain.status, 0);
    assert.match(plain.stderr, /activities \? · traces/u);
  } finally {
    await fixture.remove();
  }
});
