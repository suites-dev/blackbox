import { expect, it } from 'vitest';

import { buildSpanTree, walkSpanTree } from '../span-tree.js';
import { ACTIVITY_SPAN, shape, span } from './span.fixture.js';

const none = new Set<string>();
const activity = new Set([ACTIVITY_SPAN]);

it('nests a single trace by parentSpanId only', () => {
  const tree = buildSpanTree({
    spans: [
      span({ id: 'c', parent: 'b', start: '30' }),
      span({ id: 'a', start: '10' }),
      span({ id: 'b', parent: 'a', start: '20' }),
      span({ id: 'd', parent: 'a', start: '40' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual([['a', [['b', ['c']], 'd']]]);
});

it('never creates an edge from start-time order', () => {
  // Three parentless spans that start one after another stay three roots.
  const tree = buildSpanTree({
    spans: [
      span({ id: 'x', start: '1' }),
      span({ id: 'y', start: '2' }),
      span({ id: 'z', start: '3' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual(['x', 'y', 'z']);
});

it('drops the activity context span and makes its children roots, not orphans', () => {
  const tree = buildSpanTree({
    spans: [
      span({ id: ACTIVITY_SPAN, start: '1', service: 'blackbox-capsule' }),
      span({ id: 'server', parent: ACTIVITY_SPAN, start: '5' }),
      span({ id: 'db', parent: 'server', start: '6' }),
    ],
    activitySpanIds: activity,
    provisional: true,
  });
  expect(shape(tree)).toEqual([['server', ['db']]]);
  // Also when the context span itself was never retained.
  const withoutRoot = buildSpanTree({
    spans: [span({ id: 'server', parent: ACTIVITY_SPAN, start: '5' })],
    activitySpanIds: activity,
    provisional: false,
  });
  expect(shape(withoutRoot)).toEqual(['server']);
});

it('orders several roots and siblings by start time, then span ID', () => {
  const tree = buildSpanTree({
    spans: [
      span({ id: 'r2', start: '200' }),
      span({ id: 'r1', start: '100' }),
      span({ id: 'k-b', parent: 'r1', start: '150' }),
      span({ id: 'k-a', parent: 'r1', start: '150' }),
      span({ id: 'k-0', parent: 'r1', start: '9' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual([['r1', ['k-0', 'k-a', 'k-b']], 'r2']);
});

it('breaks start-time ties by service, then title, then span ID, never by ID alone', () => {
  const tree = buildSpanTree({
    spans: [
      // IDs sort opposite to the readable order, so an ID-only tie-break fails.
      span({ id: 'a1', start: '5', service: 'public-api', name: 'pg.query:SELECT' }),
      span({ id: 'a2', start: '5', service: 'public-api', name: 'pg-pool.connect' }),
      span({ id: 'a3', start: '5', service: 'fraud-check', name: 'zzz' }),
      span({ id: 'a0', start: '5', service: 'public-api', name: 'pg.query:SELECT' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual(['a3', 'a2', 'a0', 'a1']);
});

it('compares start times numerically, not as text', () => {
  const tree = buildSpanTree({
    spans: [span({ id: 'late', start: '1000' }), span({ id: 'early', start: '999' })],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual(['early', 'late']);
});

it('sorts a span without a start time last', () => {
  const tree = buildSpanTree({
    spans: [
      span({ id: 'a', start: null }),
      span({ id: 'b', start: '5' }),
      span({ id: 'c', start: '1' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual(['c', 'b', 'a']);
});

it('marks a root whose parent is absent as not yet observed while provisional', () => {
  const spans = [
    span({ id: 'lost', parent: 'ffffffffffffffff', start: '5' }),
    span({ id: 'ok', start: '1' }),
  ];
  expect(shape(buildSpanTree({ spans, activitySpanIds: none, provisional: true }))).toEqual([
    'ok',
    'lost!not-yet-observed',
  ]);
  expect(shape(buildSpanTree({ spans, activitySpanIds: none, provisional: false }))).toEqual([
    'ok',
    'lost!not-retained',
  ]);
});

it('breaks a cycle once, at its first member, and marks that span as an orphan', () => {
  const spans = [
    span({ id: 'p', parent: 'q', start: '1' }),
    span({ id: 'q', parent: 'r', start: '2' }),
    span({ id: 'r', parent: 'p', start: '3' }),
    span({ id: 'tail', parent: 'q', start: '4' }),
  ];
  expect(shape(buildSpanTree({ spans, activitySpanIds: none, provisional: false }))).toEqual([
    ['p!not-retained', [['r', [['q', ['tail']]]]]],
  ]);
});

it('treats a span that names itself as parent as a broken cycle', () => {
  const tree = buildSpanTree({
    spans: [span({ id: 'self', parent: 'self' })],
    activitySpanIds: none,
    provisional: true,
  });
  expect(shape(tree)).toEqual(['self!not-yet-observed']);
});

it('keeps one node per span ID', () => {
  const tree = buildSpanTree({
    spans: [span({ id: 'a' }), span({ id: 'a' })],
    activitySpanIds: none,
    provisional: false,
  });
  expect(shape(tree)).toEqual(['a']);
});

it('builds and walks 1,000 spans (wide and deep) within 500 ms', () => {
  const wide = Array.from({ length: 1000 }, (_, index) =>
    span({
      id: `w${String(index).padStart(4, '0')}`,
      parent: index === 0 ? null : 'w0000',
      start: String(1000 - index),
    }),
  );
  const deep = Array.from({ length: 1000 }, (_, index) =>
    span({
      id: `d${String(index).padStart(4, '0')}`,
      parent: index === 0 ? null : `d${String(index - 1).padStart(4, '0')}`,
      start: String(index),
    }),
  );
  const started = performance.now();
  const wideWalk = walkSpanTree(
    buildSpanTree({ spans: wide, activitySpanIds: none, provisional: false }),
  );
  const deepWalk = walkSpanTree(
    buildSpanTree({ spans: deep, activitySpanIds: none, provisional: false }),
  );
  const elapsed = performance.now() - started;
  expect(wideWalk).toHaveLength(1000);
  expect(deepWalk).toHaveLength(1000);
  expect(deepWalk[deepWalk.length - 1].depth).toBe(999);
  expect(wideWalk[1].node.span.spanId).toBe('w0999');
  expect(elapsed).toBeLessThan(500);
});

it('builds a 20,000-level chain without overflowing the stack', () => {
  const depth = 20_000;
  const chain = Array.from({ length: depth }, (_, index) =>
    span({
      id: `c${String(index).padStart(5, '0')}`,
      parent: index === 0 ? null : `c${String(index - 1).padStart(5, '0')}`,
      start: String(index),
    }),
  );
  const walk = walkSpanTree(buildSpanTree({ spans: chain, activitySpanIds: none, provisional: false }));
  expect(walk).toHaveLength(depth);
  expect(walk[depth - 1].depth).toBe(depth - 1);
});

it('walks depth-first in tree order with depths', () => {
  const tree = buildSpanTree({
    spans: [
      span({ id: 'a', start: '1' }),
      span({ id: 'b', parent: 'a', start: '2' }),
      span({ id: 'c', parent: 'b', start: '3' }),
      span({ id: 'd', parent: 'a', start: '4' }),
      span({ id: 'e', start: '5' }),
    ],
    activitySpanIds: none,
    provisional: false,
  });
  expect(
    walkSpanTree(tree).map(({ node, depth }) => `${node.span.spanId}${String(depth)}`),
  ).toEqual(['a0', 'b1', 'c2', 'd1', 'e0']);
});
