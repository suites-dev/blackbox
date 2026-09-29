// Harness tests for the golden journey runner. They need bash, not Docker.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { BashSession, JourneySessionTimeout, STATUS_SENTINEL } from './journey-session.mjs';
import { CAPTURES, createNormalizer, normalizeWhitespace, parseGolden } from './journey-format.mjs';
import { cleanupJourneyProject } from './journey-project.mjs';
import { runItems } from './journey-steps.mjs';

const execute = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

async function withSession(run, options = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'bb-journey-harness-'));
  const session = new BashSession({ cwd, env: process.env, ...options });
  try {
    return await run(session, cwd);
  } finally {
    await session.close();
    await rm(cwd, { recursive: true, force: true });
  }
}

void test('a command exiting 22, then echo $?, prints 22', async () => {
  await withSession(async (session) => {
    const failed = await session.run("sh -c 'exit 22'", 10_000);
    assert.equal(failed.status, 22);
    assert.equal(failed.output, '');
    assert.deepEqual(await session.run('echo $?', 10_000), { output: '22\n', status: 0 });
  });
});

void test('negative control: a sentinel that clobbers $? is caught by the same oracle', async () => {
  const clobbering = STATUS_SENTINEL.replace('; (exit "$__bb_s")', '');
  assert.notEqual(clobbering, STATUS_SENTINEL);
  await withSession(
    async (session) => {
      await session.run("sh -c 'exit 22'", 10_000);
      const echoed = await session.run('echo $?', 10_000);
      assert.notEqual(echoed.output, '22\n');
    },
    { sentinel: clobbering },
  );
});

void test('the status sentinel never enters compared output; stderr is combined in order', async () => {
  await withSession(async (session) => {
    const result = await session.run('echo out; echo err >&2; printf tail', 10_000);
    assert.equal(result.output, 'out\nerr\ntail');
    assert.doesNotMatch(result.output, /__BB_/u);
  });
});

void test('variables persist between lines and commands cannot consume the script', async () => {
  await withSession(async (session) => {
    await session.run('JOURNEY_VALUE=41', 10_000);
    assert.equal((await session.run('cat', 10_000)).output, '');
    assert.equal((await session.run('echo $((JOURNEY_VALUE + 1))', 10_000)).output, '42\n');
  });
});

void test('capture reads the raw output of the previous command and never re-runs it', async () => {
  await withSession(async (session, cwd) => {
    const items = parseGolden(
      '$ echo ran >> runs.txt; echo capsule calm-comet-ada-000000000001 is up\n' +
        '#! capture CAPSULE_1 capsule-up\n' +
        '$ echo $CAPSULE_1\n',
    );
    const executed = await runItems({ items, session, raw: [] });
    assert.equal(executed.at(-1).output, 'calm-comet-ada-000000000001\n');
    assert.equal(await readFile(join(cwd, 'runs.txt'), 'utf8'), 'ran\n');
  });
});

void test('a capture that does not match fails the journey', async () => {
  await withSession(async (session) => {
    const items = parseGolden('$ echo nothing here\n#! capture X capsule-up\n');
    await assert.rejects(runItems({ items, session, raw: [] }), /capture X did not match/u);
  });
});

/**
 * A shell that behaves like one killed by SIGKILL whose exit event has not
 * arrived yet: every stdin write after the command fails with EPIPE, and the
 * exit event comes later. This makes the timeout/close race deterministic.
 */
function killedShellBeforeExit() {
  const child = new EventEmitter();
  let writes = 0;
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      writes += 1;
      callback(writes > 2 ? Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }) : null);
    },
  });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  child.pid = 4_194_303; // no such process group: kill() sees ESRCH
  setTimeout(() => child.emit('exit', null, 'SIGKILL'), 200);
  return child;
}

void test('closing a session killed by a timeout never writes to its stdin', async () => {
  const session = new BashSession({
    cwd: tmpdir(),
    env: process.env,
    spawnShell: killedShellBeforeExit,
  });
  await assert.rejects(session.run('sleep 5', 20), JourneySessionTimeout);
  await session.close();
});

void test('a capture names a fixed extractor; free-form patterns are refused', () => {
  assert.equal(parseGolden('#! capture X activity\n')[0].pattern, CAPTURES.activity);
  assert.throws(() => parseGolden('#! capture X nope\n'), /Unknown capture nope/u);
  assert.throws(() => parseGolden('#! capture X /^(.*)$/\n'), /Unknown directive/u);
});

void test('#! timeout applies to the next command', async () => {
  await withSession(async (session) => {
    const items = parseGolden('#! timeout 1\n$ sleep 5\n');
    await assert.rejects(runItems({ items, session, raw: [] }), JourneySessionTimeout);
  });
});

void test('literal 200, 3000 and 404 survive normalization', () => {
  const normalize = createNormalizer();
  const text = 'HTTP 200 from port 3000, then 404\n';
  assert.equal(normalize(text), text);
});

function assertDistinctCapsules(normalize) {
  const out = normalize('calm-comet-ada-000000000001 then gentle-willow-zoe-000000000002');
  assert.equal(out, '<CAPSULE_1> then <CAPSULE_2>');
}

void test('two capsules never collapse into one placeholder', () => {
  assertDistinctCapsules(createNormalizer());
  // Negative control: a normalizer that maps every capsule to one token fails.
  const collapsing = (text) => text.replace(/[a-z]+-[a-z]+-[a-z]+-\d{12}/gu, '<CAPSULE_1>');
  assert.throws(() => {
    assertDistinctCapsules(collapsing);
  });
});

void test('the same row with IDs of different lengths normalizes identically', () => {
  const row = (capsule) =>
    `  CAPSULE${' '.repeat(capsule.length - 5)}  SYSTEM\n* ${capsule}  orders\n`;
  const short = createNormalizer()(row('calm-comet-ada-000000000001'));
  const long = createNormalizer()(row('gentle-workshop-grace-000000000002'));
  assert.notEqual(short, long);
  assert.equal(normalizeWhitespace(short), normalizeWhitespace(long));
});

void test('activity prefixes map to their full ID; unrelated hex words survive', () => {
  const activity = '3f9a2c41-7b00-4000-8000-000000000001';
  const normalize = createNormalizer({ activityIds: [activity] });
  assert.equal(
    normalize(`activity 3f9a2c41 · show ${activity} · 3f9a2c41-7b · deadbeef`),
    'activity <ACT_1> · show <ACT_1> · <ACT_1> · deadbeef',
  );
});

void test('project paths, URLs, timestamps, durations and span counts are normalized', () => {
  const normalize = createNormalizer({ projectPaths: ['/work/project', '/private/work/project'] });
  assert.equal(
    normalize(
      '✔ /private/work/project/a.html http://127.0.0.1:4310/?x=1 2026-01-01T00:00:00.000Z 12.4s 850ms 7 spans',
    ),
    '✔ <PROJECT>/a.html <URL> <TIME> <DUR> <DUR> <N> spans',
  );
});

void test('a capsule trace total is normalized; an activity trace count stays literal', () => {
  const normalize = createNormalizer();
  assert.equal(
    normalize('  activities 4 · traces 25\n  observed  collector-activity-found · 1 traces\n'),
    '  activities 4 · traces <N>\n  observed  collector-activity-found · 1 traces\n',
  );
});

async function fakeBlackbox(root) {
  const log = join(root, 'calls.log');
  const bin = join(root, 'blackbox');
  await writeFile(
    bin,
    `#!/bin/sh
echo "$PWD $*" >> ${JSON.stringify(log)}
if [ "$1" = ls ]; then cat "$PWD/capsules.json"; fi
`,
  );
  await chmod(bin, 0o755);
  return { bin, log };
}

function assertOnlyOwnCapsulesStopped(calls, own) {
  const downs = calls.filter((line) => / down /u.test(line));
  assert.deepEqual(downs, [`${own} down running-capsule-own-000000000001 --json`]);
}

void test('cleanup downs only unstopped capsules of its own isolated project', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bb-journey-cleanup-')));
  try {
    const own = join(root, 'own');
    const other = join(root, 'other');
    for (const [directory, capsules] of [
      [
        own,
        [
          ['running-capsule-own-000000000001', 'running'],
          ['stopped-capsule-own-000000000002', 'stopped'],
        ],
      ],
      [other, [['running-capsule-other-000000000003', 'running']]],
    ]) {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, 'capsules.json'),
        JSON.stringify({
          kind: 'capsule-list',
          capsules: capsules.map(([capsule, state]) => ({ capsule, state })),
        }),
      );
    }
    const { bin, log } = await fakeBlackbox(root);
    const problems = await cleanupJourneyProject({ directory: own, blackbox: bin });
    assert.deepEqual(problems, []);
    const calls = (await readFile(log, 'utf8')).trim().split('\n');
    assertOnlyOwnCapsulesStopped(calls, own);
    // Negative control: a cleanup that also stopped another project's capsule fails.
    assert.throws(() => {
      assertOnlyOwnCapsulesStopped(
        [...calls, `${other} down running-capsule-other-000000000003 --json`],
        own,
      );
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('golden updates are refused when CI=true', async () => {
  const error = await execute(process.execPath, [join(HERE, 'run-journeys.mjs')], {
    env: { ...process.env, CI: 'true', BLACKBOX_GOLDEN_UPDATE: '1' },
  }).then(
    () => null,
    (failure) => failure,
  );
  assert.notEqual(error, null);
  assert.equal(error.code, 2);
  assert.match(error.stderr, /refused when CI=true/u);
});
