import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFanOut, fanOut, LIMIT } from './check-fan-out.mjs';

const target = (index) => `packages/demo/src/dep-${index}.ts`;

/** A cruise where `source` depends on `count` distinct production modules. */
function cruiseWith(source, count, extra = []) {
  const dependencies = Array.from({ length: count }, (_, index) => ({ resolved: target(index) }));
  return {
    modules: [
      { source, dependencies: [...dependencies, ...extra] },
      ...dependencies.map(({ resolved }) => ({ source: resolved, dependencies: [] })),
    ],
  };
}

test('a module exactly at the limit passes', () => {
  assert.deepEqual(
    checkFanOut({ cruise: cruiseWith('packages/demo/src/hub.ts', LIMIT), allowlist: {} }),
    [],
  );
});

test('a new module one above the limit fails and names itself', () => {
  const problems = checkFanOut({
    cruise: cruiseWith('packages/demo/src/hub.ts', LIMIT + 1),
    allowlist: {},
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^packages\/demo\/src\/hub\.ts depends on 13 workspace modules/);
});

test('an allowlisted module above the limit passes', () => {
  assert.deepEqual(
    checkFanOut({
      cruise: cruiseWith('packages/demo/src/hub.ts', LIMIT + 3),
      allowlist: { 'packages/demo/src/hub.ts': 'composition root for the demo flow' },
    }),
    [],
  );
});

test('an allowlist entry that dropped to the limit fails so the list shrinks', () => {
  const problems = checkFanOut({
    cruise: cruiseWith('packages/demo/src/hub.ts', LIMIT),
    allowlist: { 'packages/demo/src/hub.ts': 'composition root for the demo flow' },
  });
  assert.deepEqual(problems, [
    'packages/demo/src/hub.ts is allowlisted but now depends on 12 modules. Remove the entry.',
  ]);
});

test('an allowlist entry for a missing module or without a reason fails', () => {
  const problems = checkFanOut({
    cruise: cruiseWith('packages/demo/src/hub.ts', LIMIT + 1),
    allowlist: { 'packages/demo/src/hub.ts': ' ', 'packages/demo/src/gone.ts': 'old hub' },
  });
  assert.deepEqual(problems, [
    'packages/demo/src/hub.ts is allowlisted without a reason.',
    'packages/demo/src/gone.ts is allowlisted but is not a production module. Remove the entry.',
  ]);
});

test('only distinct production workspace modules count', () => {
  const noise = [
    { resolved: target(0) },
    { resolved: 'packages/demo/src/hub.ts' },
    { resolved: 'packages/demo/src/helper.test.ts' },
    { resolved: 'packages/demo/src/testing/builder.ts' },
    { resolved: 'node_modules/.pnpm/ajv@8/node_modules/ajv/dist/2020.js' },
    { resolved: 'node:fs' },
  ];
  const counts = fanOut(cruiseWith('packages/demo/src/hub.ts', LIMIT, noise));
  assert.equal(counts.get('packages/demo/src/hub.ts'), LIMIT);
});

test('barrels, command registries and tests are not measured', () => {
  for (const source of [
    'packages/demo/src/index.ts',
    'packages/demo/src/cli/command-registry.ts',
    'packages/demo/src/hub.test.ts',
    'packages/demo/scripts/run.mjs',
  ]) {
    assert.equal(fanOut(cruiseWith(source, LIMIT + 5)).has(source), false, source);
  }
});

test('an empty or foreign document fails closed', () => {
  assert.throws(() => fanOut({ modules: [] }), /non-empty modules array/);
  assert.throws(() => fanOut({ summary: {} }), /non-empty modules array/);
});
