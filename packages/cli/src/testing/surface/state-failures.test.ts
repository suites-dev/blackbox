import assert from 'node:assert/strict';
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { readCurrentCapsule, setCurrentCapsule } from '../../context/current-capsule.js';
import { fakeManagerWith } from '../../capsule/reporting/capsule-command.fixture.js';
import { CAPSULE_A, projectFixture, twoCapsuleProject } from './project.fixture.js';
import { onlyDocument, processOutcome, run } from './run-cli.fixture.js';

function stoppedCapsule() {
  return projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'stopped',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [],
    },
  ]);
}

void test('down reports a current-capsule file it could not clear instead of treating it as not current', async () => {
  const fixture = await stoppedCapsule();
  const state = join(fixture.directory, '.blackbox', 'state');
  try {
    await setCurrentCapsule(fixture.directory, CAPSULE_A);
    await chmod(state, 0o555);
    const json = await run(fixture.directory, 'capsule', 'down', CAPSULE_A, '--json');
    assert.equal(json.status, 125);
    const document = onlyDocument(json);
    assert.equal(document.kind, 'capsule-stopped');
    assert.equal(document.capsule, CAPSULE_A);
    const warnings = document.warnings as readonly Record<string, unknown>[];
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'current-capsule-write-failed');
    assert.match(String(warnings[0].message), /is stopped but is still the current capsule/u);
    const human = await run(fixture.directory, 'capsule', 'down', CAPSULE_A);
    assert.equal(human.status, 125);
    assert.match(
      human.stderr,
      /^blackbox: capsule \S+ is stopped but is still the current capsule \(/mu,
    );
    assert.doesNotMatch(human.stderr, /current capsule: none/u);
  } finally {
    await chmod(state, 0o755);
    await fixture.remove();
  }
});

void test('down clears the current capsule and reports no warning when it can', async () => {
  const fixture = await stoppedCapsule();
  try {
    await setCurrentCapsule(fixture.directory, CAPSULE_A);
    const json = await run(fixture.directory, 'capsule', 'down', CAPSULE_A, '--json');
    assert.equal(json.status, 0, json.stderr);
    assert.deepEqual(onlyDocument(json).warnings, []);
    assert.deepEqual(await readCurrentCapsule(fixture.directory), { kind: 'none' });
  } finally {
    await fixture.remove();
  }
});

void test('show <capsule> renders an unreadable activity record as unavailable, never as 0', async () => {
  const fixture = await stoppedCapsule();
  try {
    await writeFile(
      join(
        fixture.directory,
        '.blackbox',
        'experiments',
        `capsule-${CAPSULE_A}`,
        'activities.json',
      ),
      '{not json',
    );
    const result = await run(fixture.directory, 'capsule', 'show', CAPSULE_A);
    assert.match(result.stderr, /^ {2}activities \? · traces \d+$/mu);
    assert.doesNotMatch(result.stderr, /activities 0/u);
    assert.doesNotMatch(result.stderr, /→ blackbox show/u);
  } finally {
    await fixture.remove();
  }
});

void test('an activity lookup that could not read every activity record says so instead of id-unknown', async () => {
  const fixture = await stoppedCapsule();
  try {
    const plain = await run(fixture.directory, 'capsule', 'show', '3f9a2c41', '--json');
    assert.equal(plain.status, 2);
    assert.equal(onlyDocument(plain).message, 'no capsule, activity or trace matches 3f9a2c41');
    await writeFile(
      join(
        fixture.directory,
        '.blackbox',
        'experiments',
        `capsule-${CAPSULE_A}`,
        'activities.json',
      ),
      '{not json',
    );
    const json = await run(fixture.directory, 'capsule', 'show', '3f9a2c41', '--json');
    assert.equal(json.status, 2);
    const document = onlyDocument(json);
    assert.equal(document.code, 'id-unknown');
    assert.match(String(document.message), /the activity records of 1 capsule could not be read$/u);
    const human = await run(fixture.directory, 'capsule', 'show', '3f9a2c41');
    assert.match(human.stderr, new RegExp(`^ {2}unreadable: ${CAPSULE_A}$`, 'mu'));
  } finally {
    await fixture.remove();
  }
});

void test('run prints the child output and exit code even if the registry breaks after the child ran', async () => {
  const fixture = await twoCapsuleProject();
  const experiments = join(fixture.directory, '.blackbox', 'experiments');
  const manager = await fakeManagerWith({
    socketPath: fixture.socket(CAPSULE_A),
    outcome: processOutcome({ kind: 'exited', exitCode: 7, signal: '' }),
    // The registry becomes unreadable between the child running and the reply.
    beforeRespond: () => chmod(experiments, 0o000),
  });
  try {
    const result = await run(
      fixture.directory,
      'capsule',
      'run',
      '--session',
      CAPSULE_A,
      '--',
      'x',
    );
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, 'child-out\n');
    assert.match(result.stderr, /^child-err$/mu);
    assert.match(result.stderr, new RegExp(`^activity \\S+ · capsule ${CAPSULE_A} · `, 'mu'));
  } finally {
    await chmod(experiments, 0o755);
    await manager.close();
    await fixture.remove();
  }
});

void test(
  'capsule report serve --session resolves through the registry',
  { timeout: 20_000 },
  async () => {
    const fixture = await twoCapsuleProject();
    try {
      const unknown = await run(
        fixture.directory,
        'capsule',
        'report',
        'serve',
        '--session',
        'quiet-river-ada-000000000009',
        '--port',
        '0',
      );
      assert.equal(unknown.status, 125);
      assert.equal(unknown.stdout, '');
      assert.match(
        unknown.stderr,
        /^blackbox: Capsule session quiet-river-ada-000000000009 does not exist$/mu,
      );
      const malformed = await run(
        fixture.directory,
        'capsule',
        'report',
        'serve',
        '--session',
        '../x',
      );
      assert.equal(malformed.status, 125);
      assert.match(malformed.stderr, /sessionId must be an exact Capsule-generated identity/u);
    } finally {
      await fixture.remove();
    }
  },
);
