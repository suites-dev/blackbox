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
import { cleanupJourneyProject, journeyEnvironment, newFixtureToken } from './journey-project.mjs';
import { runItems } from './journey-steps.mjs';
import { canonicalizeTrees } from './journey-trees.mjs';

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
if [ "$1" = capsule ] && [ "$2" = ls ]; then cat "$PWD/capsules.json"; fi
`,
  );
  await chmod(bin, 0o755);
  return { bin, log };
}

function assertOnlyOwnCapsulesStopped(calls, own) {
  const downs = calls.filter((line) => / capsule down /u.test(line));
  assert.deepEqual(downs, [`${own} capsule down running-capsule-own-000000000001 --json`]);
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
        [...calls, `${other} capsule down running-capsule-other-000000000003 --json`],
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

// A stand-in `blackbox` for wait tests: prints "pending" until its third
// call, then a line containing the awaited text. It counts calls in a file.
const FAKE_BLACKBOX = String.raw`blackbox() { n=$(cat calls 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > calls; if [ "$n" -ge 3 ]; then echo "later in this capsule, no known cause: a.b"; else echo pending; fi; }`;

void test('#! wait reruns a show command until its raw output contains the literal text', async () => {
  await withSession(async (session, cwd) => {
    await session.run(FAKE_BLACKBOX, 10_000);
    const items = parseGolden('#! wait 30 "no known cause" blackbox capsule show abc\n$ echo after\n');
    const raw = [];
    const executed = await runItems({ items, session, raw });
    assert.equal(await readFile(join(cwd, 'calls'), 'utf8'), '3\n');
    assert.equal(raw.filter((entry) => entry.includes('# wait')).length, 3);
    // The wait is kept as its directive line; its output is never compared.
    assert.deepEqual(
      executed.map((item) => (item.kind === 'command' ? item.output : item.line)),
      ['#! wait 30 "no known cause" blackbox capsule show abc', 'after\n'],
    );
  });
});

void test('#! wait text is a plain substring: regex metacharacters match only themselves', async () => {
  await withSession(async (session) => {
    await session.run(String.raw`blackbox() { echo "aXb"; }`, 10_000);
    const items = parseGolden('#! wait 1 "a.b" blackbox capsule ls\n');
    await assert.rejects(
      runItems({ items, session, raw: [] }),
      /wait for "a\.b" timed out after 1000 ms/u,
    );
  });
});

void test('#! wait fails the journey at its timeout', async () => {
  await withSession(async (session) => {
    await session.run(String.raw`blackbox() { echo pending; }`, 10_000);
    const items = parseGolden('#! wait 1 "never" blackbox capsule show abc\n$ echo unreached\n');
    const executed = [];
    const started = Date.now();
    await assert.rejects(
      runItems({ items, session, raw: [], executed }),
      /timed out after 1000 ms/u,
    );
    assert.ok(Date.now() - started >= 1000);
    assert.deepEqual(executed, []);
  });
});

void test('#! wait only polls one blackbox capsule show or ls, refused at parse time', () => {
  for (const command of [
    'blackbox capsule run -- true',
    'blackbox capsule down',
    'rm -rf .',
    'blackbox capsule showx',
    'blackbox show x',
    'sh -c blackbox capsule show',
    // A valid prefix may not chain, pipe, redirect or substitute a second command.
    'blackbox capsule show x; blackbox capsule down',
    'blackbox capsule ls && rm -rf .',
    'blackbox capsule ls | sh',
    'blackbox capsule show x > out',
    'blackbox capsule show $(rm -rf .)',
    'blackbox capsule show `rm -rf .`',
    "blackbox capsule show 'x'",
  ]) {
    assert.throws(
      () => parseGolden(`#! wait 5 "x" ${command}\n`),
      /may only poll blackbox capsule show or blackbox capsule ls/u,
    );
  }
  assert.equal(parseGolden('#! wait 5 "x" blackbox capsule ls\n')[0].command, 'blackbox capsule ls');
  assert.equal(
    parseGolden('#! wait 5 "x" blackbox capsule show $A --session $C_1 --json\n')[0].command,
    'blackbox capsule show $A --session $C_1 --json',
  );
});

void test('negative control: no directive accepts a regex', () => {
  assert.throws(
    () => parseGolden('#! wait 5 "/no known.*/" blackbox capsule show x\n'),
    /literal text, not a regex/u,
  );
  assert.throws(() => parseGolden('#! wait 5 "/x/u" blackbox capsule ls\n'), /literal text, not a regex/u);
  assert.throws(() => parseGolden('#! capture X /^(\\S+)$/\n'), /Unknown directive/u);
  // A slash inside plain text is still literal text.
  assert.equal(parseGolden('#! wait 5 "a/b" blackbox capsule ls\n')[0].text, 'a/b');
});

void test('show-trace is a fixed capture of the full trace ID in a show suggestion', () => {
  const trace = 'f'.repeat(31) + '0';
  const pattern = CAPTURES['show-trace'];
  assert.equal(
    pattern.exec(`observed …\n→ blackbox capsule show ${trace} --session c --spans\n`)[1],
    trace,
  );
  assert.equal(pattern.exec('→ blackbox capsule show 3f9a2c41 --session c\n'), null);
  // A longer hex token is not cut down to its first 32 characters.
  assert.equal(pattern.exec(`→ blackbox capsule show ${trace}ff --session c\n`), null);
  assert.equal(pattern.exec(`  blackbox capsule show ${trace} \n`), null);
  assert.equal(parseGolden('#! capture T show-trace\n')[0].pattern, pattern);
});

void test('tree indentation survives whitespace normalization; column gaps still collapse', () => {
  const tree = [
    '    root',
    '    ├─ a    x',
    '    │     ├─ deep',
    '    │        └─ deeper',
    '           └─ far',
  ];
  assert.deepEqual(normalizeWhitespace(tree.join('\n')).split('\n'), [
    '  root',
    '    ├─ a  x',
    '    │     ├─ deep',
    '    │        └─ deeper',
    '           └─ far',
  ]);
  // Depths that differ stay different after normalization.
  assert.notEqual(normalizeWhitespace('    │     ├─ x'), normalizeWhitespace('    │  ├─ x'));
});

void test('the startup trace count before the first activity is normalized; others stay literal', () => {
  const normalize = createNormalizer();
  assert.equal(
    normalize('  +3.1s  (no activity)  ┈┈ 31 traces before the first activity'),
    '  +<DUR>  (no activity)  ┈┈ <N> traces before the first activity',
  );
  assert.equal(normalize('observed  1 traces · 4 services'), 'observed  1 traces · 4 services');
});

void test('span IDs, trace short forms and the fixture secret are normalized', () => {
  const trace = '0123456789abcdef0123456789abcdef';
  const normalize = createNormalizer({ traceIds: [trace], secrets: ['s3cr3t-token'] });
  assert.equal(
    normalize(
      `later 01234567  public-api\n→ blackbox capsule show ${trace}\nSPAN aaaabbbbccccdddd  PARENT 1111222233334444  again aaaabbbbccccdddd`,
    ),
    'later <TRACE_1>  public-api\n→ blackbox capsule show <TRACE_1>\nSPAN <SPAN_1>  PARENT <SPAN_2>  again <SPAN_1>',
  );
  assert.equal(normalize('Bearer s3cr3t-token ok'), 'Bearer <SECRET> ok');
  // An 8-hex word that is no retained trace or activity survives.
  assert.equal(createNormalizer({ traceIds: [trace] })('deadbeef'), 'deadbeef');
});

void test('each journey gets its own fixture token, only in its own environment', () => {
  const first = newFixtureToken();
  const second = newFixtureToken();
  assert.match(first, /^[0-9a-f]{48}$/u);
  assert.notEqual(first, second);
  const base = { PATH: '/usr/bin', BLACKBOX_CAPSULE: 'ambient' };
  const env = journeyEnvironment({ binDirectory: '/bin/bb', fixtureToken: first, base });
  assert.equal(env.FIXTURE_CONTROL_TOKEN, first);
  assert.equal(env.PATH, '/bin/bb:/usr/bin');
  assert.equal(env.BLACKBOX_CAPSULE, undefined);
  assert.deepEqual(base, { PATH: '/usr/bin', BLACKBOX_CAPSULE: 'ambient' });
  assert.equal(process.env.FIXTURE_CONTROL_TOKEN, undefined);
});

const ACTIVITY_TREE = (children) =>
  [
    'activity abc',
    '  observed  1 traces',
    '  SPANS',
    '    api POST /s 201',
    ...children,
    '  later in this capsule, no known cause:',
    '    x',
  ].join('\n');

void test('span tree siblings are compared in canonical order; depth and parent still count', () => {
  const first = ACTIVITY_TREE([
    '    ├─ api SET',
    '    ├─ api POST /assess 200',
    '    │  └─ fraud POST /assess 200',
    '    └─ api GET',
  ]);
  const second = ACTIVITY_TREE([
    '    ├─ api POST /assess 200',
    '    │  └─ fraud POST /assess 200',
    '    ├─ api GET',
    '    └─ api SET',
  ]);
  assert.equal(canonicalizeTrees(first), canonicalizeTrees(second));
  assert.match(
    canonicalizeTrees(first),
    /    ├─ api GET\n    ├─ api POST \/assess 200\n    │  └─ fraud POST \/assess 200\n    └─ api SET\n  later/u,
  );
  // Negative control: the same spans under a different parent never compare equal.
  const moved = ACTIVITY_TREE([
    '    ├─ api SET',
    '    │  └─ fraud POST /assess 200',
    '    ├─ api POST /assess 200',
    '    └─ api GET',
  ]);
  assert.notEqual(canonicalizeTrees(moved), canonicalizeTrees(first));
  // Output without trees is untouched.
  assert.equal(
    canonicalizeTrees('capsule x  running\n  activities 1'),
    'capsule x  running\n  activities 1',
  );
});

void test('--spans rows are reordered by tree, ignoring IDs and durations; parents still count', () => {
  const header = '  SPAN              PARENT            SERVICE  KIND    TITLE    RESULT  DURATION';
  const row = (id, parent, title, duration) =>
    `  ${id}  ${parent}  api      client  ${title.padEnd(7)}  200     ${duration}`;
  const root = row('aaaaaaaaaaaaaaaa', '1111111111111111', 'POST /s', '9ms');
  const first = [
    'trace t · capsule c · 3 spans · complete',
    header,
    root,
    row('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa', 'SET', '1ms'),
    row('cccccccccccccccc', 'aaaaaaaaaaaaaaaa', 'GET', '2ms'),
    '→ next',
  ].join('\n');
  const second = [
    'trace t · capsule c · 3 spans · complete',
    header,
    root.replace('9ms', '12ms'),
    row('dddddddddddddddd', 'aaaaaaaaaaaaaaaa', 'GET', '3ms'),
    row('eeeeeeeeeeeeeeee', 'aaaaaaaaaaaaaaaa', 'SET', '1ms'),
    '→ next',
  ].join('\n');
  const titles = (text) =>
    canonicalizeTrees(text)
      .split('\n')
      .slice(2, 5)
      .map((line) => /client {2}(.+?) {2,}200/u.exec(line)?.[1]);
  assert.deepEqual(titles(first), ['POST /s', 'GET', 'SET']);
  assert.deepEqual(titles(second), ['POST /s', 'GET', 'SET']);
  // Negative control: GET under SET instead of under the root is a different tree.
  const nested = first.replace(
    row('cccccccccccccccc', 'aaaaaaaaaaaaaaaa', 'GET', '2ms'),
    row('cccccccccccccccc', 'bbbbbbbbbbbbbbbb', 'GET', '2ms'),
  );
  assert.deepEqual(titles(nested), ['POST /s', 'SET', 'GET']);
});
