import assert from 'node:assert/strict';
import test from 'node:test';

import { EXIT_CODES } from '../../cli/exit-codes.js';
import { fakeManager } from '../../capsule/reporting/capsule-command.fixture.js';
import { ACTIVITY_A, CAPSULE_A, projectFixture, twoCapsuleProject } from './project.fixture.js';
import { onlyDocument, processOutcome, run } from './run-cli.fixture.js';

/** Adds --json among Blackbox's own arguments (before `--`, if any). */
function withJson(argv: readonly string[]): string[] {
  const separator = argv.indexOf('--');
  return separator < 0
    ? [...argv, '--json']
    : [...argv.slice(0, separator), '--json', ...argv.slice(separator)];
}

async function runOutcome(outcome: Readonly<Record<string, unknown>>, ...extra: string[]) {
  const fixture = await twoCapsuleProject();
  const manager = await fakeManager({ socketPath: fixture.socket(CAPSULE_A), outcome });
  try {
    return await run(fixture.directory, 'run', '--capsule', CAPSULE_A, ...extra, '--', 'sh');
  } finally {
    await manager.close();
    await fixture.remove();
  }
}

void test('run passes a child exit N through; 1, 2 and 3 never collide with Blackbox codes', async () => {
  for (const exitCode of [0, 1, 2, 3, 22]) {
    const result = await runOutcome(processOutcome({ kind: 'exited', exitCode, signal: '' }));
    assert.equal(result.status, exitCode, result.stderr);
    assert.match(result.stderr, new RegExp(`· exit ${String(exitCode)} · `, 'u'));
  }
});

void test('run maps a signaled child to 128 + the signal number', async () => {
  for (const [signal, code] of [
    ['SIGTERM', 143],
    ['SIGKILL', 137],
    ['SIGINT', 130],
  ] as const) {
    const result = await runOutcome(processOutcome({ kind: 'signaled', exitCode: 0, signal }));
    assert.equal(result.status, code, signal);
    assert.match(result.stderr, new RegExp(`· signal ${signal} · `, 'u'));
  }
});

void test('run returns 127 for a missing executable and 125 for a driver failure', async () => {
  const missing = await runOutcome({
    kind: 'executable-not-found',
    argv: ['sh'],
    location: { kind: 'host' },
    remediation: 'Install "sh" on the host.',
  });
  assert.equal(missing.status, EXIT_CODES.executableNotFound);
  assert.match(missing.stderr, /· host · host · not found · /u);
  const prepareFailed = await runOutcome(
    {
      kind: 'driver-prepare-failed',
      driverId: 'public-api',
      propagation: {
        schemaVersion: 1,
        kind: 'telemetry-propagation-v1',
        expectation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
        outcome: { kind: 'context-not-injected', reason: 'driver-prepare-failed' },
      },
      error: { name: 'Error', message: 'no endpoint' },
    },
    '--via',
    'public-api',
  );
  assert.equal(prepareFailed.status, EXIT_CODES.blackboxFailure);
  assert.equal(
    prepareFailed.stderr,
    `activity 00000000 · capsule ${CAPSULE_A} · stimulus · via public-api · not run\n` +
      'blackbox: Driver "public-api" could not prepare the command: no endpoint\n' +
      `→ blackbox show 00000000 --capsule ${CAPSULE_A}\n`,
  );
});

void test('run turns every usage and resolution error into 125', async () => {
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
    const cases = [
      [['run', '--no-such-flag', '--', 'true'], 'usage'],
      [['run', '--capsule', CAPSULE_A], 'usage'],
      [['run', '--', 'true'], 'capsule-unresolved'],
      [['run', '--capsule', CAPSULE_A, '--', 'true'], 'capsule-not-running'],
      [['capsule', 'exec', '--no-such-flag', '--session', CAPSULE_A, '--', 'true'], 'usage'],
    ] as const;
    for (const [argv, code] of cases) {
      const human = await run(fixture.directory, ...argv);
      assert.equal(human.status, EXIT_CODES.blackboxFailure, argv.join(' '));
      assert.equal(human.stdout, '');
      const json = await run(fixture.directory, ...withJson(argv));
      assert.equal(json.status, EXIT_CODES.blackboxFailure, argv.join(' '));
      assert.equal(onlyDocument(json).code, code, argv.join(' '));
    }
  } finally {
    await fixture.remove();
  }
});

void test('the same flag error exits 2 on show; oclif default 2 is what run overrides', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const show = await run(fixture.directory, 'show', ACTIVITY_A, '--no-such-flag');
    assert.equal(show.status, EXIT_CODES.usage);
    assert.match(show.stderr, /^blackbox: Nonexistent flag: --no-such-flag\n/u);
    assert.match(show.stderr, /→ blackbox show --help\n$/u);
    // Negative control: an unchanged plain oclif command keeps oclif's own 2.
    const plain = await run(fixture.directory, 'catalog', 'validate', '--no-such-flag');
    assert.equal(plain.status, 2);
    const runFlag = await run(fixture.directory, 'run', '--no-such-flag', '--', 'true');
    assert.notEqual(runFlag.status, plain.status);
  } finally {
    await fixture.remove();
  }
});

void test('other commands: usage/resolution 2, Blackbox failure 125, reserved 3, success 0', async () => {
  const fixture = await twoCapsuleProject();
  try {
    const expectations = [
      [['show', 'deadbeef'], EXIT_CODES.usage],
      [['down', ACTIVITY_A], EXIT_CODES.usage],
      [['down'], EXIT_CODES.usage],
      [['report', '--output', '-', '--json'], EXIT_CODES.usage],
      [['use', 'no-such-capsule-000000000009'], EXIT_CODES.usage],
      [['down', '--capsule', 'quiet-river-ada-000000000009'], EXIT_CODES.blackboxFailure],
      [
        ['show', ACTIVITY_A, '--capsule', 'quiet-river-ada-000000000009'],
        EXIT_CODES.blackboxFailure,
      ],
      [['setup', 'init'], EXIT_CODES.reserved],
      [['ls'], EXIT_CODES.success],
    ] as const;
    for (const [argv, code] of expectations) {
      const result = await run(fixture.directory, ...argv);
      assert.equal(result.status, code, `${argv.join(' ')}: ${result.stderr}`);
    }
  } finally {
    await fixture.remove();
  }
});
