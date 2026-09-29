import assert from 'node:assert/strict';
import test from 'node:test';

import { lsLines } from '../operations/inspection/ls-command.js';
import { formatColumns, formatDuration } from './output.js';

void test('columns are sized to content, two spaces apart, with no trailing spaces', () => {
  assert.deepEqual(
    formatColumns([
      ['NAME', 'KIND', 'SERVICES'],
      ['aa', 'system', '8', 'default'],
      ['bbbbbbbb', 'sub', '10'],
    ]),
    ['NAME      KIND    SERVICES', 'aa        system  8         default', 'bbbbbbbb  sub     10'],
  );
});

void test('ls marks the current capsule and aligns every column', () => {
  const row = (capsule: string, activities: number) => ({
    capsule,
    system: 'orders',
    state: 'running' as const,
    startedAt: '2026-01-01T00:00:00.000Z',
    activities,
    title: 'Orders demo',
  });
  assert.deepEqual(
    lsLines({
      rows: [row('calm-comet-ada-000000000001', 3), row('gentle-willow-zoe-000000000002', 12)],
      current: 'gentle-willow-zoe-000000000002',
      all: false,
    }),
    [
      '  CAPSULE                         SYSTEM  STATE    STARTED                   ACTIVITIES  TITLE',
      '  calm-comet-ada-000000000001     orders  running  2026-01-01T00:00:00.000Z  3           Orders demo',
      '* gentle-willow-zoe-000000000002  orders  running  2026-01-01T00:00:00.000Z  12          Orders demo',
    ],
  );
  assert.deepEqual(lsLines({ rows: [], current: null, all: false }), [
    '  CAPSULE  SYSTEM  STATE  STARTED  ACTIVITIES  TITLE',
    'no running capsules',
  ]);
  assert.deepEqual(lsLines({ rows: [], current: null, all: true })[1], 'no capsules');
});

void test('durations print as milliseconds below one second, else tenths of seconds', () => {
  assert.equal(formatDuration(850), '850ms');
  assert.equal(formatDuration(12_449), '12.4s');
});
