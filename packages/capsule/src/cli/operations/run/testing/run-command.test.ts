import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

import { EXIT_CODES } from '../../../cli/exit-codes.js';
import {
  fakeManager,
  fixtureActivityId,
} from '../../../capsule/reporting/capsule-command.fixture.js';
import { cliExecutable } from '../../../testing/cli-path.fixture.js';
import { CAPSULE_A, projectFixture } from '../../../testing/surface/project.fixture.js';
import { onlyDocument, run } from '../../../testing/surface/run-cli.fixture.js';

const SECRET = 'Bearer run-command-secret-42';
const ARGV = ['curl', '-H', `Authorization: ${SECRET}`, 'http://127.0.0.1:4567/x'];

/** The manager's reply: the child exited 7 after writing to both streams. */
const EXITED_7 = {
  kind: 'exited',
  argv: ['sh'],
  location: { kind: 'host' },
  exitCode: 7,
  stdout: 'child-out\n',
  stderr: 'child-err\n',
  retention: {
    stdout: { kind: 'complete', originalBytes: 10 },
    stderr: { kind: 'complete', originalBytes: 10 },
  },
  propagation: {
    schemaVersion: 1,
    kind: 'telemetry-propagation-v1',
    expectation: { kind: 'propagation-not-requested' },
    outcome: { kind: 'context-not-injected', reason: 'raw-command' },
  },
};

/**
 * A running capsule whose registry holds the activity the fake manager
 * reports, recorded with a credential in its argv. No collector state
 * exists, so nothing is ever observed and the wait ends after its quiet period.
 */
async function withRecordedActivity<T>(
  body: (fixture: Awaited<ReturnType<typeof projectFixture>>) => Promise<T>,
  outcome: Readonly<Record<string, unknown>> = EXITED_7,
): Promise<T> {
  const fixture = await projectFixture([
    {
      sessionId: CAPSULE_A,
      state: 'running',
      system: 'orders',
      admittedAt: '2026-01-01T00:00:00.000Z',
      activities: [
        {
          activityId: fixtureActivityId,
          traceId: 'c'.repeat(32),
          name: 'Probe',
          exitCode: 7,
          argv: ARGV,
        },
      ],
    },
  ]);
  const manager = await fakeManager({ socketPath: fixture.socket(CAPSULE_A), outcome });
  try {
    return await body(fixture);
  } finally {
    await manager.close();
    await fixture.remove();
  }
}

function runArgs(...extra: string[]): string[] {
  return ['capsule', 'run', '--session', CAPSULE_A, ...extra, '--', ...ARGV];
}

void test('run prints the observed block after the child output and keeps its exit code', async () => {
  await withRecordedActivity(async (fixture) => {
    const result = await run(fixture.directory, ...runArgs());
    assert.equal(result.status, 7);
    assert.equal(result.stdout, 'child-out\n');
    assert.match(
      result.stderr,
      new RegExp(
        [
          '^child-err',
          `activity 00000000 · capsule ${CAPSULE_A} · stimulus · host · host · exit 7 · \\d+(?:\\.\\d)?m?s`,
          '  context   untraced: no driver, so no trace context was sent',
          '  observed  nothing yet · provisional \\(capsule running\\)',
          `→ blackbox capsule show 00000000 --session ${CAPSULE_A}`,
          '$',
        ].join('\\n'),
        'u',
      ),
    );
    for (const output of [result.stdout, result.stderr]) {
      assert.doesNotMatch(output, /run-command-secret|Authorization|curl/u);
    }
  });
});

void test('run --json: one document with context, observation and limitations', async () => {
  await withRecordedActivity(async (fixture) => {
    const result = await run(fixture.directory, ...runArgs('--json'));
    assert.equal(result.status, 7);
    assert.equal(result.stderr, '');
    const document = onlyDocument(result);
    assert.equal(document.kind, 'capsule-exec-completed');
    assert.deepEqual(document.context, { kind: 'untraced' });
    const observation = document.observation as Record<string, unknown>;
    assert.equal(observation.status, 'provisional');
    assert.equal(observation.spans, 0);
    assert.equal(typeof observation.waitedMs, 'number');
    assert.ok((observation.waitedMs as number) >= 700, String(observation.waitedMs));
    assert.equal(observation.stillArriving, false);
    assert.deepEqual(document.limitations, [
      { kind: 'observation-provisional' },
      { kind: 'untraced' },
    ]);
    assert.deepEqual(document.next, [`blackbox capsule show 00000000 --session ${CAPSULE_A}`]);
    // The fields 2b adds never carry the command line.
    const added = JSON.stringify([document.context, document.observation, document.limitations]);
    assert.doesNotMatch(added, /run-command-secret|Authorization|curl/u);
  });
});

void test('--wait 0 does not wait', async () => {
  await withRecordedActivity(async (fixture) => {
    const document = onlyDocument(
      await run(fixture.directory, ...runArgs('--wait', '0', '--json')),
    );
    assert.equal((document.observation as Record<string, unknown>).waitedMs, 0);
  });
});

void test('an invalid --wait is a usage error, 125 on run', async () => {
  await withRecordedActivity(async (fixture) => {
    for (const value of ['-1', '1.5', 'soon', '']) {
      const human = await run(fixture.directory, ...runArgs('--wait', value));
      assert.equal(human.status, EXIT_CODES.blackboxFailure, value);
      assert.equal(human.stdout, '', value);
      assert.match(human.stderr, /--wait/u, value);
      const json = onlyDocument(
        await run(fixture.directory, ...runArgs('--json', '--wait', value)),
      );
      assert.equal(json.kind, 'cli-error', value);
      assert.equal(json.code, 'usage', value);
    }
    // Negative control: a valid value is accepted.
    assert.equal((await run(fixture.directory, ...runArgs('--wait', '0'))).status, 7);
  });
});

void test('Ctrl-C during the wait prints the block and keeps the child exit code', async () => {
  await withRecordedActivity(async (fixture) => {
    const env = { ...process.env };
    delete env.BLACKBOX_CAPSULE;
    const child = spawn(process.execPath, [cliExecutable(), ...runArgs('--wait', '60000')], {
      cwd: fixture.directory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const closed = once(child, 'close');
    // The child's output is written after the exec returned, once Ctrl-C is
    // already handled and before the wait begins.
    await once(child.stdout, 'data');
    assert.equal(child.exitCode, null, 'still waiting when interrupted');
    child.kill('SIGINT');
    const [status, signal] = (await closed) as [number | null, NodeJS.Signals | null];
    assert.equal(signal, null);
    assert.equal(status, 7);
    assert.match(stderr, / {2}observed {2}nothing yet · provisional \(capsule running\)\n→ /u);
  });
});

void test('a driver failure before any process existed: no wait, phase 1 output unchanged', async () => {
  const failure = {
    kind: 'driver-prepare-failed',
    driverId: 'public-api',
    propagation: {
      schemaVersion: 1,
      kind: 'telemetry-propagation-v1',
      expectation: { kind: 'w3c-trace-context-propagation', carrier: 'http-headers' },
      outcome: { kind: 'context-not-injected', reason: 'driver-prepare-failed' },
    },
    error: { name: 'Error', message: 'no endpoint' },
  };
  await withRecordedActivity(async (fixture) => {
    const started = Date.now();
    const document = onlyDocument(
      await run(fixture.directory, ...runArgs('--via', 'public-api', '--json')),
    );
    assert.ok(Date.now() - started < 5000);
    assert.equal('context' in document, false);
    assert.equal('observation' in document, false);
    // The phase 1 document is unchanged: nothing is added for a failed driver.
    assert.equal('limitations' in document, false);
    const human = await run(fixture.directory, ...runArgs('--via', 'public-api'));
    assert.equal(human.status, EXIT_CODES.blackboxFailure);
    assert.equal(
      human.stderr,
      `activity 00000000 · capsule ${CAPSULE_A} · stimulus · via public-api · not run\n` +
        'blackbox: Driver "public-api" could not prepare the command: no endpoint\n' +
        `→ blackbox capsule show 00000000 --session ${CAPSULE_A}\n`,
    );
  }, failure);
});

void test('run --json redacts credentials from the printed argv, keeping argv[0]', async () => {
  const argv = [
    'curl',
    '-H',
    `Authorization: ${SECRET}`,
    'https://alice:pw-secret-42@127.0.0.1:4567/x?token=tk-secret-42',
  ];
  await withRecordedActivity(
    async (fixture) => {
      const result = await run(fixture.directory, ...runArgs('--wait', '0', '--json'));
      assert.equal(result.status, 7);
      const document = onlyDocument(result);
      const outcome = document.outcome as { argv: readonly string[]; stdout: string };
      assert.deepEqual(outcome.argv, [
        'curl',
        '-H',
        'Authorization: [REDACTED]',
        'https://[REDACTED]@127.0.0.1:4567/x?token=[REDACTED]',
      ]);
      // Only argv changes: the child's output is printed as captured.
      assert.equal(outcome.stdout, 'child-out\n');
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /run-command-secret|pw-secret|tk-secret|alice/u,
      );
      // Negative control: the manager's reply did carry the credentials.
      assert.match(JSON.stringify(argv), /run-command-secret.*pw-secret.*tk-secret/u);
    },
    { ...EXITED_7, argv },
  );
});
