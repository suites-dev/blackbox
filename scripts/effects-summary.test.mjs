import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { format, summarize } from './effects-summary.mjs';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/effects-summary/results.json', import.meta.url));
const fixtureRoot = dirname(fixture);
const runner = fileURLToPath(new URL('./effects-summary-run.mjs', import.meta.url));

function titled(summaries, start) {
  const found = summaries.find(({ title }) => title.includes(start));
  assert.ok(found, `no summary for ${start}`);
  return found;
}

test('counts the effects of a test once, although three assertions read the same stimulus', async () => {
  const postgres = titled(
    await summarize(fixture, { root: fixtureRoot }),
    'PostgreSQL activity is observed',
  );
  assert.deepEqual(
    postgres.record.effects.map(({ kind, count }) => `${kind}×${String(count)}`),
    ['db×2', 'http×1'],
  );
});

test('counts the effects of a rolled-back test once', async () => {
  const rollback = titled(
    await summarize(fixture, { root: fixtureRoot }),
    'remains observable after rollback',
  );
  assert.equal(rollback.status, 'passed');
  assert.deepEqual(
    rollback.record.effects.map(({ kind, count }) => `${kind}×${String(count)}`),
    ['db×4', 'http×1'],
  );
});

test('never reports a test as complete when the projection says its coverage is partial', async () => {
  const rollback = titled(
    await summarize(fixture, { root: fixtureRoot }),
    'remains observable after rollback',
  );
  assert.equal(rollback.record.completeness.status, 'incomplete');
  assert.match(rollback.record.completeness.reason, /coverage partial/u);
});

test('a test whose telemetry was withheld stays an empty, incomplete record, not "no effects happened"', async () => {
  const withheld = titled(await summarize(fixture, { root: fixtureRoot }), '@withheld');
  assert.deepEqual(withheld.record.effects, []);
  assert.equal(withheld.record.completeness.status, 'incomplete');
  assert.match(withheld.record.completeness.reason, /coverage unknown/u);
  assert.match(format([withheld]), /no effects observed/u);
});

test('gives the same output for the same results file', async () => {
  assert.equal(
    JSON.stringify(await summarize(fixture, { root: fixtureRoot })),
    JSON.stringify(await summarize(fixture, { root: fixtureRoot })),
  );
});

test('a changed effect changes the record: one more database operation is one more count', async (t) => {
  const document = JSON.parse(await readFile(fixture, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const attachments = document.suites
    .flatMap(function visit(suite) {
      return [...suite.specs, ...suite.suites.flatMap(visit)];
    })
    .filter(({ title }) => title.includes('after rollback'))
    .flatMap(({ tests }) =>
      tests.flatMap(({ results }) => results.flatMap(({ attachments }) => attachments)),
    )
    .filter(({ name }) => name === 'blackbox-effects');
  for (const attachment of attachments) {
    const body = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    const effects = body.evidence.projection.effects;
    effects.push({ ...effects.find(({ kind }) => kind === 'db'), id: 'extra-effect' });
    attachment.body = Buffer.from(JSON.stringify(body)).toString('base64');
  }
  const changed = join(directory, 'results.json');
  await writeFile(changed, JSON.stringify(document));
  const rollback = titled(await summarize(changed, { root: directory }), 'after rollback');
  assert.equal(rollback.record.effects.find(({ kind }) => kind === 'db').count, 5);
});

test('the command prints a table, and valid JSON with --json', async () => {
  const table = await run(process.execPath, [runner, basename(fixture)], { cwd: fixtureRoot });
  assert.match(table.stdout, /db:unknown:unknown×4/u);
  const json = JSON.parse(
    (await run(process.execPath, [runner, basename(fixture), '--json'], { cwd: fixtureRoot }))
      .stdout,
  );
  assert.equal(json.length, 3);
  assert.equal(json[0].record.schemaVersion, 0);
});

test('the command exits with 2 and a usage line when it gets no file', async () => {
  await assert.rejects(run(process.execPath, [runner], { cwd: fixtureRoot }), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /usage:/u);
    return true;
  });
});

test('evidence that was not admitted makes the record incomplete and says so', async (t) => {
  const document = JSON.parse(await readFile(fixture, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const attachments = document.suites
    .flatMap(function visit(suite) {
      return [...suite.specs, ...suite.suites.flatMap(visit)];
    })
    .filter(({ title }) => title.includes('after rollback'))
    .flatMap(({ tests }) =>
      tests.flatMap(({ results }) => results.flatMap(({ attachments }) => attachments)),
    )
    .filter(({ name }) => name === 'blackbox-effects');
  for (const attachment of attachments) {
    const body = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    body.evidence = { kind: 'withheld' };
    attachment.body = Buffer.from(JSON.stringify(body)).toString('base64');
  }
  const withheld = join(directory, 'results.json');
  await writeFile(withheld, JSON.stringify(document));
  const rollback = titled(await summarize(withheld, { root: directory }), 'after rollback');
  assert.deepEqual(rollback.record.effects, []);
  assert.equal(rollback.record.completeness.status, 'incomplete');
  assert.match(rollback.record.completeness.reason, /evidence withheld/u);
});

test('refuses a results file outside the allowed directory', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(summarize(fixture, { root: directory }), /is outside/u);
  await assert.rejects(
    summarize(join(directory, '..', 'results.json'), { root: directory }),
    /is outside/u,
  );
});

test('refuses an attachment path that leaves the results directory', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const results = {
    suites: [
      {
        title: 's',
        specs: [
          {
            title: 'spec',
            tests: [
              {
                results: [
                  {
                    status: 'passed',
                    attachments: [{ name: 'blackbox-effects', path: '/etc/hosts' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const file = join(directory, 'results.json');
  await writeFile(file, JSON.stringify(results));
  await assert.rejects(summarize(file, { root: directory }), /is outside/u);
});

test('names each record after the attempt sandbox, not after the test title', async () => {
  const rollback = titled(await summarize(fixture, { root: fixtureRoot }), 'after rollback');
  assert.equal(rollback.record.source.kind, 'playwright-attempt');
  assert.match(rollback.record.source.id, /^playwright-[0-9a-f-]{36}$/u);
});

test('a test with no effects attachment is incomplete, never a complete record with no effects', async (t) => {
  const document = JSON.parse(await readFile(fixture, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const result of document.suites
    .flatMap(function visit(suite) {
      return [...suite.specs, ...suite.suites.flatMap(visit)];
    })
    .flatMap(({ tests }) => tests.flatMap(({ results }) => results))) {
    result.attachments = result.attachments.filter(({ name }) => name !== 'blackbox-effects');
  }
  const bare = join(directory, 'results.json');
  await writeFile(bare, JSON.stringify(document));
  const summaries = await summarize(bare, { root: directory });
  assert.equal(summaries.length, 3);
  for (const { record } of summaries) {
    assert.deepEqual(record.effects, []);
    assert.equal(record.completeness.status, 'incomplete');
    assert.match(record.completeness.reason, /no effects evidence/u);
  }
});

function allResults(document) {
  return document.suites
    .flatMap(function visit(suite) {
      return [...suite.specs, ...suite.suites.flatMap(visit)];
    })
    .flatMap((spec) => spec.tests.map((test) => ({ spec, test })));
}

function effectsBodies(result) {
  return result.attachments
    .filter(({ name }) => name === 'blackbox-effects')
    .map((attachment) => ({
      attachment,
      body: JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')),
    }));
}

function store(attachment, body) {
  attachment.body = Buffer.from(JSON.stringify(body)).toString('base64');
}

/** The real fixture, changed by `mutate` and written to a directory of its own. */
async function changedFixture(t, mutate) {
  const document = JSON.parse(await readFile(fixture, 'utf8'));
  const directory = await mkdtemp(join(tmpdir(), 'effects-summary-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  mutate(document, directory);
  const file = join(directory, 'results.json');
  await writeFile(file, JSON.stringify(document));
  return { file, root: directory };
}

test('counts an effect once when a later assertion reads a scope that holds the earlier stimulus too', async (t) => {
  const { file, root } = await changedFixture(t, (document) => {
    const { test: rollback } = allResults(document).find(({ spec }) =>
      spec.title.includes('after rollback'),
    );
    const [result] = rollback.results;
    const [{ attachment, body }] = effectsBodies(result);
    const later = structuredClone(body);
    later.evidence.projection.scope.id = 'activity-later';
    later.evidence.projection.effects.push({
      ...later.evidence.projection.effects[0],
      id: 'a-new-effect',
      kind: 'cache',
      operation: 'GET',
      target: 'orders',
    });
    result.attachments.push({
      ...attachment,
      body: Buffer.from(JSON.stringify(later)).toString('base64'),
    });
  });
  const rollback = titled(await summarize(file, { root }), 'after rollback');
  assert.deepEqual(
    rollback.record.effects.map(({ kind, count }) => `${kind}×${String(count)}`),
    ['cache×1', 'db×4', 'http×1'],
  );
});

for (const [name, change, expected] of [
  [
    'omitted effects',
    (body) => {
      body.evidence.omitted.effects = 3;
    },
    /omitted effects/u,
  ],
  [
    'truncated strings',
    (body) => {
      body.display.truncatedStrings = 2;
    },
    /truncated strings/u,
  ],
]) {
  test(`a record is incomplete when the adapter reports ${name}`, async (t) => {
    const { file, root } = await changedFixture(t, (document) => {
      const { test: rollback } = allResults(document).find(({ spec }) =>
        spec.title.includes('after rollback'),
      );
      for (const { attachment, body } of effectsBodies(rollback.results[0])) {
        change(body);
        store(attachment, body);
      }
    });
    const rollback = titled(await summarize(file, { root }), 'after rollback');
    assert.equal(rollback.record.completeness.status, 'incomplete');
    assert.match(rollback.record.completeness.reason, expected);
  });
}

test('a retried test has one record per attempt, and the retry is shown', async (t) => {
  const { file, root } = await changedFixture(t, (document) => {
    const { test: rollback } = allResults(document).find(({ spec }) =>
      spec.title.includes('after rollback'),
    );
    rollback.results.push({ ...structuredClone(rollback.results[0]), retry: 1, status: 'failed' });
  });
  const attempts = (await summarize(file, { root })).filter(({ title }) =>
    title.includes('after rollback'),
  );
  assert.deepEqual(
    attempts.map(({ retry, status }) => `${String(retry)}:${status}`),
    ['0:passed', '1:failed'],
  );
  assert.match(format(attempts), /\(retry 1\)/u);
});

test('a symbolic link inside the directory cannot lead to a file outside it', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'effects-summary-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.json'), JSON.stringify({ suites: [] }));
  const { file, root } = await changedFixture(t, () => {});
  await symlink(join(outside, 'secret.json'), join(root, 'link.json'));
  await assert.rejects(summarize(join(root, 'link.json'), { root }), /resolves outside/u);
  const document = JSON.parse(await readFile(file, 'utf8'));
  const { test: first } = allResults(document)[0];
  first.results[0].attachments = [{ name: 'blackbox-effects', path: 'link.json' }];
  await writeFile(file, JSON.stringify(document));
  await assert.rejects(summarize(file, { root }), /resolves outside/u);
});

test('the printed effect line shows an outcome, so a run that differs only in outcome prints differently', async (t) => {
  const plain = format(await summarize(fixture, { root: fixtureRoot }));
  const { file, root } = await changedFixture(t, (document) => {
    for (const { test } of allResults(document)) {
      for (const result of test.results) {
        for (const { attachment, body } of effectsBodies(result)) {
          for (const effect of body.evidence.projection.effects) effect.outcome = 'failure';
          store(attachment, body);
        }
      }
    }
  });
  const failed = format(await summarize(file, { root }));
  assert.notEqual(failed, plain);
  assert.match(failed, /:failure×/u);
});
