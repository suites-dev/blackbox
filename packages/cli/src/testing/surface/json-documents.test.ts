import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { fakeManager } from '../../capsule/reporting/capsule-command.fixture.js';
import {
  ACTIVITY_A,
  CAPSULE_A,
  CAPSULE_B,
  TRACE_A,
  TRACE_B,
  projectFixture,
  twoCapsuleProject,
} from './project.fixture.js';
import { onlyDocument, processOutcome, run } from './run-cli.fixture.js';

const UNKNOWN = 'quiet-river-ada-000000000009';

void test('run --json: one capsule-exec-completed document for every execution outcome', async () => {
  const fixture = await twoCapsuleProject();
  try {
    for (const [outcome, status] of [
      [processOutcome({ kind: 'exited', exitCode: 0, signal: '' }), 0],
      [processOutcome({ kind: 'exited', exitCode: 9, signal: '' }), 9],
      [processOutcome({ kind: 'signaled', exitCode: 0, signal: 'SIGTERM' }), 143],
      [
        { kind: 'executable-not-found', argv: ['x'], location: { kind: 'host' }, remediation: 'r' },
        127,
      ],
    ] as const) {
      const manager = await fakeManager({ socketPath: fixture.socket(CAPSULE_A), outcome });
      try {
        const result = await run(
          fixture.directory,
          'run',
          '--capsule',
          CAPSULE_A,
          '--json',
          '--',
          'x',
        );
        assert.equal(result.status, status);
        const document = onlyDocument(result);
        assert.equal(document.kind, 'capsule-exec-completed');
        assert.equal(document.capsule, CAPSULE_A);
        assert.deepEqual(document.next, [`blackbox show 00000000 --capsule ${CAPSULE_A}`]);
        assert.equal(result.stderr, '');
      } finally {
        await manager.close();
      }
    }
    const missing = await run(fixture.directory, 'run', '--capsule', UNKNOWN, '--json', '--', 'x');
    assert.equal(missing.status, 125);
    assert.equal(onlyDocument(missing).kind, 'capsule-not-found');
    const flag = await run(fixture.directory, 'run', '--json', '--bogus', '--', 'x');
    assert.equal(flag.status, 125);
    assert.deepEqual(onlyDocument(flag), {
      kind: 'cli-error',
      code: 'usage',
      message: 'Nonexistent flag: --bogus\nSee more help with --help',
      next: ['blackbox run --help'],
    });
  } finally {
    await fixture.remove();
  }
});

void test('show --json: the observation document plus capsule and next, for all three kinds', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const cases = [
      [ACTIVITY_A, 'collector-activity-missing', []],
      [
        CAPSULE_A,
        'collector-session-missing',
        ['blackbox show 3f9a2c41-7c --capsule ' + CAPSULE_A],
      ],
      [TRACE_A, 'collector-trace-missing', ['blackbox show 3f9a2c41-7b --capsule ' + CAPSULE_A]],
    ] as const;
    for (const [id, kind, next] of cases) {
      const result = await run(fixture.directory, 'show', id, '--json');
      assert.equal(result.status, 0, result.stderr);
      const document = onlyDocument(result);
      assert.equal(document.kind, kind);
      assert.equal(document.capsule, CAPSULE_A);
      assert.deepEqual(document.next, next);
    }
  } finally {
    await fixture.remove();
  }
});

void test('show --json failures: cli-error with candidates for ambiguity and mismatch', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const ambiguous = await run(fixture.directory, 'show', '3f9a2c41', '--json');
    assert.equal(ambiguous.status, 2);
    const document = onlyDocument(ambiguous);
    assert.equal(document.code, 'id-ambiguous');
    assert.equal((document.candidates as unknown[]).length, 2);
    const mismatch = await run(
      fixture.directory,
      'show',
      TRACE_B,
      '--capsule',
      CAPSULE_A,
      '--json',
    );
    assert.equal(mismatch.status, 2);
    assert.deepEqual(onlyDocument(mismatch), {
      kind: 'cli-error',
      code: 'id-capsule-mismatch',
      message: `${TRACE_B} is not in capsule ${CAPSULE_A}`,
      candidates: [{ id: TRACE_B, type: 'trace', capsule: CAPSULE_B, name: null }],
      next: [`blackbox show ${TRACE_B} --capsule ${CAPSULE_B}`],
    });
    const unknown = await run(fixture.directory, 'show', 'deadbeef', '--json');
    assert.equal(unknown.status, 2);
    assert.equal('candidates' in onlyDocument(unknown), false);
  } finally {
    await fixture.remove();
  }
});

void test('ls, use, down and report --json documents', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const selected = await run(fixture.directory, 'use', CAPSULE_A, '--json');
    assert.deepEqual(onlyDocument(selected), {
      kind: 'capsule-selected',
      capsule: CAPSULE_A,
      system: 'orders',
      state: 'running',
      previous: null,
      next: [],
    });
    const again = await run(fixture.directory, 'use', CAPSULE_B, '--json');
    assert.equal(onlyDocument(again).previous, CAPSULE_A);
    const listed = onlyDocument(await run(fixture.directory, 'ls', '--json'));
    assert.equal(listed.kind, 'capsule-list');
    assert.equal(listed.scope, 'active');
    assert.equal(listed.current, CAPSULE_B);
    assert.deepEqual(listed.capsules, [
      {
        capsule: CAPSULE_B,
        system: 'payments',
        state: 'running',
        startedAt: '2026-01-02T00:00:00.000Z',
        activities: 1,
        title: 'payments demo',
      },
      {
        capsule: CAPSULE_A,
        system: 'orders',
        state: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        activities: 2,
        title: 'orders demo',
      },
    ]);
    assert.deepEqual(listed.next, []);
    const report = await run(fixture.directory, 'report', CAPSULE_A, '--json');
    assert.equal(report.status, 0, report.stderr);
    assert.deepEqual(onlyDocument(report), {
      kind: 'capsule-report-written',
      capsule: CAPSULE_A,
      files: [
        {
          format: 'html',
          path: join(
            fixture.directory,
            `.blackbox/reports/capsule-${CAPSULE_A}/capsule-report.html`,
          ),
        },
        {
          format: 'json',
          path: join(
            fixture.directory,
            `.blackbox/reports/capsule-${CAPSULE_A}/capsule-report.json`,
          ),
        },
      ],
      next: [],
    });
    const raw = await run(
      fixture.directory,
      'report',
      CAPSULE_A,
      '--format',
      'json',
      '--output',
      '-',
    );
    assert.equal(JSON.parse(raw.stdout).kind, 'capsule-operational-report');
    const conflict = await run(fixture.directory, 'report', CAPSULE_A, '--output', '-', '--json');
    assert.equal(conflict.status, 2);
    assert.equal(onlyDocument(conflict).code, 'conflicting-output');
    const missing = await run(fixture.directory, 'down', '--capsule', UNKNOWN, '--json');
    assert.equal(missing.status, 125);
    assert.equal(onlyDocument(missing).kind, 'capsule-not-found');
  } finally {
    await fixture.remove();
  }
});

void test('down --json on a stopped capsule is capsule-stopped plus capsule and next', async () => {
  const fixture = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'stopped',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [],
    },
  ]);
  try {
    const result = await run(fixture.directory, 'down', CAPSULE_A, '--json');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(onlyDocument(result), {
      kind: 'capsule-stopped',
      sessionId: CAPSULE_A,
      cleanup: 'complete',
      alreadyStopped: true,
      capsule: CAPSULE_A,
      warnings: [],
      next: [`blackbox report ${CAPSULE_A}`],
    });
    const human = await run(fixture.directory, 'down', CAPSULE_A);
    assert.equal(human.stdout, '');
    assert.equal(
      human.stderr,
      `capsule ${CAPSULE_A} was already stopped · evidence kept\n→ blackbox report ${CAPSULE_A}\n`,
    );
  } finally {
    await fixture.remove();
  }
});
