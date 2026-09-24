import assert from 'node:assert/strict';
import test from 'node:test';

import { commandFixture, removeFixture, runCli } from './reporting/capsule-command.fixture.js';

const traceId = '11111111111111111111111111111111';

void test('observations selects exact session, activity, and trace reads', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const selections = [
      {
        argv: ['observations', '--session', fixture.sessionId, '--json'],
        kind: 'collector-session-missing',
      },
      {
        argv: [
          'observations',
          '--session',
          fixture.sessionId,
          '--activity',
          'activity-1',
          '--json',
        ],
        kind: 'collector-activity-missing',
      },
      {
        argv: [
          'observations',
          '--session',
          fixture.sessionId,
          '--trace',
          traceId,
          '--json',
        ],
        kind: 'collector-trace-missing',
      },
    ] as const;
    for (const selection of selections) {
      const result = await runCli({ directory: fixture.directory, argv: selection.argv });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).kind, selection.kind);
    }
  } finally {
    await removeFixture(fixture.directory);
  }
});

void test('observations rejects simultaneous activity and trace selectors', async () => {
  const fixture = await commandFixture('stopped');
  try {
    const result = await runCli({
      directory: fixture.directory,
      argv: [
        'observations',
        '--session',
        fixture.sessionId,
        '--activity',
        'activity-1',
        '--trace',
        traceId,
      ],
    });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /cannot be used together/u);
  } finally {
    await removeFixture(fixture.directory);
  }
});
