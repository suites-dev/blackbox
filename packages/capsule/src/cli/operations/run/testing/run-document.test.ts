import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import type { CapsuleActivityReport } from '@suites/blackbox-capsule';

import { activityView } from '../../inspection/show-activity.js';
import { runBlockLines, runDocument } from '../run-block.js';
import {
  FORBIDDEN_WORDS,
  SNAPSHOTS,
  block,
  named,
  running,
  waited,
} from './run-recorded.fixture.js';

void test('run block: the tree keeps server, messaging and database spans only', async () => {
  const recorded = await running();
  const activity = named(recorded, 'Create Alice subscription');
  const input = block(recorded, activity, waited(812));
  const tree = runBlockLines(input).filter(
    (line) => line.startsWith('    ') && !line.startsWith('    Both'),
  );
  const all = activityView({ ...input, ...input.snapshot }).lines.join('\n');
  // show prints the HTTP client hop; run lifts the server span it called.
  assert.match(all, /public-api {2}POST \/assess {2}200/u);
  assert.ok(!tree.some((line) => line.includes('public-api  POST /assess')), tree.join('\n'));
  assert.ok(tree.some((line) => line.includes('fraud-check  POST /assess  200')));
  assert.ok(tree.some((line) => line.includes('public-api  pg.query:INSERT subscriptions')));
  assert.ok(tree.some((line) => line.includes('order-service  subscription-orders')));
  // The JSON tree keeps every span kind.
  const document = runDocument(input) as { observation: { tree: unknown } };
  assert.match(
    JSON.stringify(document.observation.tree),
    /"kind":"client","title":"POST \/assess"/u,
  );
});

void test('secrets: no argv, name value or token in the run block or its JSON', async () => {
  const recorded = await running();
  const base = named(recorded, 'Create Alice subscription');
  const secret = 'Bearer run-secret-0123456789';
  const argv = ['curl', '-H', `Authorization: ${secret}`, '/subscriptions'];
  const activity = {
    ...base,
    argv,
    outcome:
      base.kind === 'completed' && base.outcome.kind === 'driver-completed'
        ? { ...base.outcome, process: { ...base.outcome.process, argv } }
        : base.kind === 'completed'
          ? base.outcome
          : undefined,
  } as CapsuleActivityReport;
  const withSecret = {
    ...recorded,
    activities: recorded.activities.map((candidate) =>
      candidate.activityId === activity.activityId ? activity : candidate,
    ),
  };
  const input = block(withSecret, activity, { waitedMs: 5000, stillArriving: true });
  const printed = [runBlockLines(input).join('\n'), JSON.stringify(runDocument(input))];
  for (const output of printed) {
    assert.doesNotMatch(output, /run-secret|Authorization|curl/u);
  }
  // Negative control: the activity handed to the renderer does carry the secret.
  assert.match(JSON.stringify(input.snapshot.activity), /run-secret/u);
});

void test('word rule: no run snapshot claims success, verification or effects', async () => {
  const files = (await readdir(SNAPSHOTS)).filter((file) => file.endsWith('.txt'));
  assert.ok(files.length >= 9, `expected every run snapshot, found ${String(files.length)}`);
  for (const file of files) {
    assert.doesNotMatch(await readFile(join(SNAPSHOTS, file), 'utf8'), FORBIDDEN_WORDS, file);
  }
  for (const word of ['success', 'Successful', 'passed', 'verified', 'effect', 'effects']) {
    assert.match(`observed ${word} here`, FORBIDDEN_WORDS, word);
  }
});
