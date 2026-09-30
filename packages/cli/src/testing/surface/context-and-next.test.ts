import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { fakeManager, fixtureActivityId } from '../../capsule/reporting/capsule-command.fixture.js';
import {
  ACTIVITY_A,
  CAPSULE_A,
  CAPSULE_B,
  TRACE_A,
  fixtureActivity,
  projectFixture,
} from './project.fixture.js';
import { capsule, cli, onlyDocument, processOutcome } from './run-cli.fixture.js';

const CAPSULE_C = 'steady-harbor-maya-000000000003';

/** A (running, current target), B (running, the "other" capsule), C (stopped). */
function threeCapsules() {
  return projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [
        fixtureActivity(ACTIVITY_A, TRACE_A, 'Create order'),
        fixtureActivity(fixtureActivityId, 'cccccccccccccccccccccccccccccccc'),
      ],
    },
    {
      sessionId: CAPSULE_B,
      state: 'running',
      system: 'payments',
      admittedAt: '2026-01-02T00:00:00.000Z',
      activities: [],
    },
    {
      sessionId: CAPSULE_C,
      state: 'stopped',
      system: 'orders',
      admittedAt: '2026-01-03T00:00:00.000Z',
      activities: [],
    },
  ]);
}

function nextOf(document: Record<string, unknown>): string[] {
  const next = document.next;
  assert.ok(Array.isArray(next));
  return next.map(String);
}

void test('every suggestion names its capsule and still targets it under another BLACKBOX_CAPSULE', async () => {
  const fixture = await threeCapsules();
  const manager = await fakeManager({
    socketPath: fixture.socket(CAPSULE_A),
    outcome: processOutcome({ kind: 'exited', exitCode: 0, signal: '' }),
  });
  try {
    const suggestions = [
      ...nextOf(
        onlyDocument(
          await capsule(fixture.directory, 'run', '--session', CAPSULE_A, '--json', '--', 'x'),
        ),
      ),
      ...nextOf(onlyDocument(await capsule(fixture.directory, 'show', CAPSULE_A, '--json'))),
      ...nextOf(onlyDocument(await capsule(fixture.directory, 'show', TRACE_A, '--json'))),
      ...nextOf(onlyDocument(await capsule(fixture.directory, 'down', ACTIVITY_A, '--json'))),
      ...nextOf(
        onlyDocument(
          await capsule(fixture.directory, 'show', TRACE_A, '--session', CAPSULE_B, '--json'),
        ),
      ),
    ];
    assert.equal(suggestions.length, 5);
    for (const suggestion of suggestions) {
      assert.match(
        suggestion,
        new RegExp(`(--session|down|report) ${CAPSULE_A}\\b`, 'u'),
        suggestion,
      );
      const argv = suggestion.replace(/^blackbox /u, '').split(' ');
      if (argv[1] === 'down') {
        continue; // Verified by name above; running it would stop a fixture without a manager.
      }
      const result = await cli({
        directory: fixture.directory,
        argv: [...argv, '--json'],
        capsuleEnvironment: CAPSULE_B,
      });
      assert.equal(result.status, 0, `${suggestion}: ${result.stdout}`);
      assert.equal(onlyDocument(result).capsule, CAPSULE_A, suggestion);
    }
    // Negative control: the same suggestion without its capsule is steered by the environment.
    const bare = await cli({
      directory: fixture.directory,
      argv: ['capsule', 'show', ACTIVITY_A.slice(0, 11), '--json'],
      capsuleEnvironment: CAPSULE_B,
    });
    assert.equal(onlyDocument(bare).code, 'id-capsule-mismatch');
    const report = onlyDocument(await capsule(fixture.directory, 'down', CAPSULE_C, '--json'));
    assert.deepEqual(nextOf(report), [`blackbox capsule report ${CAPSULE_C}`]);
    const reported = await cli({
      directory: fixture.directory,
      argv: ['capsule', 'report', CAPSULE_C, '--json'],
      capsuleEnvironment: CAPSULE_B,
    });
    assert.equal(onlyDocument(reported).capsule, CAPSULE_C);
  } finally {
    await manager.close();
    await fixture.remove();
  }
});

void test('human output names the capsule acted on, including one taken from the current file', async () => {
  const fixture = await threeCapsules();
  const manager = await fakeManager({
    socketPath: fixture.socket(CAPSULE_A),
    outcome: processOutcome({ kind: 'exited', exitCode: 0, signal: '' }),
  });
  try {
    const used = await capsule(fixture.directory, 'use', CAPSULE_A);
    assert.equal(used.stderr, `current capsule: ${CAPSULE_A} (orders, running)\n`);
    const ran = await capsule(fixture.directory, 'run', '--', 'x');
    assert.equal(ran.stdout, 'child-out\n');
    assert.match(
      ran.stderr,
      new RegExp(`^child-err\\nactivity 00000000 · capsule ${CAPSULE_A} · `, 'u'),
    );
    const ranJson = onlyDocument(await capsule(fixture.directory, 'run', '--json', '--', 'x'));
    assert.equal(ranJson.capsule, CAPSULE_A);
    const reported = await capsule(fixture.directory, 'report', '--format', 'json');
    assert.match(reported.stderr, new RegExp(`^report for capsule ${CAPSULE_A}\\n✔ `, 'u'));
    assert.equal(
      onlyDocument(await capsule(fixture.directory, 'report', '--json')).capsule,
      CAPSULE_A,
    );
    const shown = await capsule(fixture.directory, 'show', ACTIVITY_A);
    assert.equal(
      shown.stderr,
      [
        'activity 3f9a2c41  Create order',
        `  capsule   ${CAPSULE_A} (orders, running)`,
        '  purpose   stimulus',
        '  via       host',
        '  process   exit 0 on host',
        '  context   untraced: no driver, so no trace context was sent',
        '  observed  nothing yet · provisional (capsule running)',
        '',
      ].join('\n'),
    );
    assert.equal(
      (await capsule(fixture.directory, 'show', CAPSULE_A)).stderr,
      `capsule ${CAPSULE_A}  orders  running · provisional (capsule running)\n  activities 2 · traces 0\n→ blackbox capsule show 00000000 --session ${CAPSULE_A}\n`,
    );
    assert.equal(
      (await capsule(fixture.directory, 'show', TRACE_A)).stderr,
      `trace ${TRACE_A} · capsule ${CAPSULE_A} · 0 spans · provisional (capsule running)\n→ blackbox capsule show 3f9a2c41 --session ${CAPSULE_A}\n`,
    );
  } finally {
    await manager.close();
    await fixture.remove();
  }
});

void test('down clears the current capsule only when it is the one stopped', async () => {
  const fixture = await threeCapsules();
  try {
    await capsule(fixture.directory, 'use', CAPSULE_A);
    const other = await capsule(fixture.directory, 'down', CAPSULE_C);
    assert.doesNotMatch(other.stderr, /current capsule: none/u);
    assert.equal(onlyDocument(await capsule(fixture.directory, 'ls', '--json')).current, CAPSULE_A);
    await capsule(fixture.directory, 'use', CAPSULE_C);
    const own = await capsule(fixture.directory, 'down');
    assert.equal(
      own.stderr,
      `capsule ${CAPSULE_C} was already stopped · evidence kept\ncurrent capsule: none\n→ blackbox capsule report ${CAPSULE_C}\n`,
    );
    assert.equal(onlyDocument(await capsule(fixture.directory, 'ls', '--json')).current, null);
  } finally {
    await fixture.remove();
  }
});

void test('a malformed or unknown current-capsule file is ignored with one warning and kept', async () => {
  const fixture = await threeCapsules();
  try {
    const file = join(fixture.directory, '.blackbox', 'state', 'current-capsule');
    await mkdir(join(fixture.directory, '.blackbox', 'state'), { recursive: true });
    for (const [content, reason] of [
      ['not an id\n', 'malformed'],
      ['rapid-river-noah-000000000009\n', 'unknown capsule rapid-river-noah-000000000009'],
    ] as const) {
      await writeFile(file, content);
      const result = await capsule(fixture.directory, 'run', '--', 'x');
      assert.equal(result.status, 125);
      assert.equal(
        result.stderr,
        `blackbox: ignoring .blackbox/state/current-capsule (${reason}); pass --session or run blackbox capsule use\n` +
          'blackbox: no capsule selected\n→ blackbox capsule ls\n',
      );
      const listed = await capsule(fixture.directory, 'ls');
      assert.doesNotMatch(listed.stderr, /^\* /mu);
    }
  } finally {
    await fixture.remove();
  }
});
