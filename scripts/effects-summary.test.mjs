import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { format, summarize } from './effects-summary.mjs';

const run = promisify(execFile);
const fixture = fileURLToPath(new URL('./fixtures/effects-summary/results.json', import.meta.url));
const runner = fileURLToPath(new URL('./effects-summary-run.mjs', import.meta.url));

function titled(summaries, start) {
  const found = summaries.find(({ title }) => title.includes(start));
  assert.ok(found, `no summary for ${start}`);
  return found;
}

test('counts the effects of a test once, although three assertions read the same stimulus', async () => {
  const postgres = titled(await summarize(fixture), 'PostgreSQL activity is observed');
  assert.deepEqual(
    postgres.record.effects.map(({ kind, count }) => `${kind}×${String(count)}`),
    ['db×2', 'http×1'],
  );
});

test('counts the effects of a rolled-back test once', async () => {
  const rollback = titled(await summarize(fixture), 'remains observable after rollback');
  assert.equal(rollback.status, 'passed');
  assert.deepEqual(
    rollback.record.effects.map(({ kind, count }) => `${kind}×${String(count)}`),
    ['db×4', 'http×1'],
  );
});

test('never reports a test as complete when the projection says its coverage is partial', async () => {
  const rollback = titled(await summarize(fixture), 'remains observable after rollback');
  assert.equal(rollback.record.completeness.status, 'incomplete');
  assert.match(rollback.record.completeness.reason, /coverage partial/u);
});

test('a test whose telemetry was withheld stays an empty, incomplete record, not "no effects happened"', async () => {
  const withheld = titled(await summarize(fixture), '@withheld');
  assert.deepEqual(withheld.record.effects, []);
  assert.equal(withheld.record.completeness.status, 'incomplete');
  assert.match(withheld.record.completeness.reason, /coverage unknown/u);
  assert.match(format([withheld]), /no effects observed/u);
});

test('gives the same output for the same results file', async () => {
  assert.equal(JSON.stringify(await summarize(fixture)), JSON.stringify(await summarize(fixture)));
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
  const rollback = titled(await summarize(changed), 'after rollback');
  assert.equal(rollback.record.effects.find(({ kind }) => kind === 'db').count, 5);
});

test('the command prints a table, and valid JSON with --json', async () => {
  const table = await run(process.execPath, [runner, fixture]);
  assert.match(table.stdout, /db:unknown:unknown×4/u);
  const json = JSON.parse((await run(process.execPath, [runner, fixture, '--json'])).stdout);
  assert.equal(json.length, 3);
  assert.equal(json[0].record.schemaVersion, 0);
});

test('the command exits with 2 and a usage line when it gets no file', async () => {
  await assert.rejects(run(process.execPath, [runner]), (error) => {
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
  const rollback = titled(await summarize(withheld), 'after rollback');
  assert.deepEqual(rollback.record.effects, []);
  assert.equal(rollback.record.completeness.status, 'incomplete');
  assert.match(rollback.record.completeness.reason, /evidence withheld/u);
});
