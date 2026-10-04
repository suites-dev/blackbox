import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSpanTree, type CapsuleReportSpan } from '@suites/blackbox-capsule';

import { treeLines } from '../../inspection/show-format.js';
import { filterRunTree, isRunTreeSpan, runTreeLines, runTreeSize } from '../run-tree.js';

/** One span; attributes and a parent only where a test needs them. */
// eslint-disable-next-line max-params -- span fixture builder whose positional defaults keep each test's span table to one line per span
function span(
  id: string,
  kind: CapsuleReportSpan['spanKind'],
  parent: string | null = null,
  start = 1,
  attributes: Readonly<Record<string, string>> = {},
): CapsuleReportSpan {
  return {
    traceId: 't'.repeat(32),
    spanId: id,
    parentSpanId: parent,
    spanKind: kind,
    operation: id,
    service: 'svc',
    startTimeUnixNano: String(start),
    endTimeUnixNano: null,
    statusCode: null,
    statusMessage: null,
    exceptions: [],
    attributes: Object.entries(attributes).map(([key, value]) => ({ key, value })),
    links: [],
  };
}

void test('run keeps server, consumer, producer and system client spans only', () => {
  const kept = (kind: CapsuleReportSpan['spanKind'], attributes = {}) =>
    isRunTreeSpan(span('a', kind, null, 1, attributes));
  assert.equal(kept('server'), true);
  assert.equal(kept('consumer'), true);
  assert.equal(kept('producer'), true);
  assert.equal(kept('client', { 'db.system': 'postgresql' }), true);
  assert.equal(kept('client', { 'db.system.name': 'redis' }), true);
  assert.equal(kept('client', { 'messaging.system': 'kafka' }), true);
  assert.equal(kept('client', { 'rpc.system': 'grpc' }), true);
  assert.equal(kept('client', { 'http.request.method': 'GET' }), false);
  assert.equal(kept('client', { 'db.system': '' }), false);
  assert.equal(kept('client'), false);
  assert.equal(kept('internal', { 'db.system': 'postgresql' }), false);
  assert.equal(kept('unspecified'), false);
});

void test('a kept span hangs under its nearest kept ancestor, in tree order', () => {
  const roots = buildSpanTree({
    spans: [
      span('server', 'server', null, 1),
      span('http', 'client', 'server', 2),
      span('remote', 'server', 'http', 3),
      span('query', 'client', 'remote', 4, { 'db.system.name': 'pg' }),
      span('work', 'internal', 'server', 5),
      span('send', 'producer', 'work', 6),
      span('plain', 'client', 'server', 7),
    ],
    activitySpanIds: new Set(),
    provisional: false,
  });
  assert.deepEqual(treeLines(filterRunTree(roots)), [
    'svc  server',
    '├─ svc  remote',
    '│  └─ svc  query',
    '└─ svc  send',
  ]);
});

void test('kept spans below a dropped orphan root become roots with its mark', () => {
  const roots = buildSpanTree({
    spans: [
      span('http', 'client', 'missing', 1),
      span('remote', 'server', 'http', 2),
      span('db', 'client', 'remote', 3, { 'db.system': 'pg' }),
      span('loose', 'internal', null, 4),
      span('reply', 'consumer', 'loose', 5),
    ],
    activitySpanIds: new Set(),
    provisional: true,
  });
  assert.deepEqual(treeLines(filterRunTree(roots)), [
    'svc  remote  (parent not yet observed)',
    '└─ svc  db',
    'svc  reply',
  ]);
});

void test('at most 40 lines, then one line counting the rest', () => {
  const spans = [
    span('root', 'server'),
    ...Array.from({ length: 45 }, (_, index) =>
      span(`s${String(index).padStart(3, '0')}`, 'server', 'root', index + 2),
    ),
  ];
  const roots = buildSpanTree({ spans, activitySpanIds: new Set(), provisional: false });
  const lines = runTreeLines(roots);
  assert.equal(lines.length, 41);
  assert.equal(lines[40], '… 6 more spans');
  assert.equal(runTreeLines(roots, 46).length, 46);
  assert.equal(runTreeLines(roots, 0).join('\n'), '… 46 more spans');
});

void test('a deep trace is filtered without recursion', () => {
  const depth = 50_000;
  const spans = Array.from({ length: depth }, (_, index) =>
    span(
      `d${String(index)}`,
      index % 2 === 0 ? 'server' : 'internal',
      index === 0 ? null : `d${String(index - 1)}`,
      index + 1,
    ),
  );
  const roots = buildSpanTree({ spans, activitySpanIds: new Set(), provisional: false });
  const filtered = filterRunTree(roots);
  let count = 0;
  for (let nodes = filtered; nodes.length > 0; nodes = nodes[0].children) {
    count += 1;
  }
  assert.equal(count, depth / 2);
});

void test('a very deep trace formats only the lines shown', () => {
  const depth = 20_000;
  let formatted = 0;
  const spans = Array.from({ length: depth }, (_, index) => {
    const base = span(
      `d${String(index)}`,
      'server',
      index === 0 ? null : `d${String(index - 1)}`,
      index + 1,
    );
    // Only formatting a line reads the service (start times differ, so sorting never does).
    return Object.defineProperty({ ...base }, 'service', {
      get: () => {
        formatted += 1;
        return 'svc';
      },
      enumerable: true,
    });
  });
  const roots = buildSpanTree({ spans, activitySpanIds: new Set(), provisional: false });
  formatted = 0;
  const lines = runTreeLines(roots);
  assert.equal(lines.length, 41);
  assert.equal(lines[40], `… ${String(depth - 40)} more spans`);
  assert.equal(lines[39], `${'   '.repeat(38)}└─ svc  d39`);
  assert.equal(formatted, 40);
  formatted = 0;
  assert.equal(runTreeSize(roots), depth);
  assert.equal(formatted, 0);
});
