import assert from 'node:assert/strict';
import test from 'node:test';

import type { CapsuleReportSpan, SpanTreeNode } from '@suites/blackbox-capsule';

import { contextText, showDuration, statusText, treeLines } from '../show-format.js';
import { treeDocument } from '../show-json.js';

function node(
  spanId: string,
  children: readonly SpanTreeNode[] = [],
  orphan: SpanTreeNode['orphan'] = null,
): SpanTreeNode {
  const span = {
    traceId: 'a'.repeat(32),
    spanId,
    parentSpanId: null,
    spanKind: 'server',
    operation: `op ${spanId}`,
    service: 'svc',
    startTimeUnixNano: '1',
    endTimeUnixNano: '2',
    statusCode: null,
    statusMessage: null,
    exceptions: [],
    attributes: [],
    links: [],
  } satisfies CapsuleReportSpan;
  return { span, orphan, children };
}

void test('durations: <n>ms under 1 s, <n.n>s under 60 s, <m>m<ss>s after', () => {
  const cases = [
    [0, '0ms'],
    [12.4, '12ms'],
    [999.4, '999ms'],
    [999.6, '1.0s'],
    [1049, '1.0s'],
    [12_345, '12.3s'],
    [59_949, '59.9s'],
    [59_950, '1m00s'],
    [61_000, '1m01s'],
    [605_000, '10m05s'],
    [-5, '0ms'],
  ] as const;
  for (const [milliseconds, text] of cases) {
    assert.equal(showDuration(milliseconds), text, String(milliseconds));
  }
});

void test('status text for each completeness', () => {
  assert.equal(statusText({ status: 'provisional' }), 'provisional (capsule running)');
  assert.equal(statusText({ status: 'complete' }), 'complete');
  assert.equal(
    statusText({ status: 'incomplete', reason: 'collector shutdown timed out' }),
    'incomplete (collector shutdown timed out)',
  );
});

void test('tree lines use tree connectors, one continuation per ancestor, and two spaces between parts', () => {
  const roots = [
    node('a', [node('b', [node('c'), node('d', [node('e')])]), node('f', [node('g')])]),
    node('orphan', [], 'not-retained'),
  ];
  assert.deepEqual(treeLines(roots), [
    'svc  op a',
    '├─ svc  op b',
    '│  ├─ svc  op c',
    '│  └─ svc  op d',
    '│     └─ svc  op e',
    '└─ svc  op f',
    '   └─ svc  op g',
    'svc  op orphan  (parent not retained)',
  ]);
  assert.deepEqual(treeLines([node('x', [], 'not-yet-observed')]), [
    'svc  op x  (parent not yet observed)',
  ]);
});

void test('tree lines and the JSON tree handle a 20,000-level chain without recursion', () => {
  let root = node('leaf');
  for (let level = 1; level < 20_000; level += 1) {
    root = node(`s${String(level)}`, [root]);
  }
  const lines = treeLines([root]);
  assert.equal(lines.length, 20_000);
  assert.equal(lines[0], 'svc  op s19999');
  let document = treeDocument([root])[0];
  let depth = 0;
  while (document.children.length > 0) {
    document = document.children[0];
    depth += 1;
  }
  assert.equal(depth, 19_999);
  assert.equal(document.spanId, 'leaf');
});

void test('context text for every propagation outcome', () => {
  assert.equal(
    contextText({ kind: 'sent', carrier: 'http-headers' }, 'public-api'),
    'sent (w3c, http-headers)',
  );
  assert.equal(
    contextText({ kind: 'not-carried', resource: 'redis' }, 'redis'),
    'not carried: redis is shared state (expected for this driver)',
  );
  assert.equal(
    contextText({ kind: 'untraced' }, null),
    'untraced: no driver, so no trace context was sent',
  );
  assert.equal(
    contextText({ kind: 'not-sent' }, 'shell'),
    'not sent: driver shell declares no propagation',
  );
  assert.equal(
    contextText({ kind: 'injection-failed', carrier: 'http-headers', message: 'no header' }, 'api'),
    'injection failed: no header',
  );
});

void test('an error span prints its exception type after the result, in lines and JSON', () => {
  const failing = node('a');
  const span = {
    ...failing.span,
    statusCode: 2,
    exceptions: [{ type: 'java.net.NoRouteToHostException', message: 'No route to host' }],
  };
  const root = { ...failing, span };
  assert.deepEqual(treeLines([root]), ['svc  op a  error  java.net.NoRouteToHostException']);
  const [failed] = treeDocument([root]);
  const [plain] = treeDocument([node('b')]);
  assert.equal(failed.failure, 'java.net.NoRouteToHostException');
  assert.equal(plain.failure, null);
});
