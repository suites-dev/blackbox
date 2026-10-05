import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { censusVerdict, discoverTestFiles } from './run-node-tests.mjs';

const RUNNER = fileURLToPath(new URL('./run-node-tests.mjs', import.meta.url));

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'run-node-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

function run(root, patterns) {
  return spawnSync(process.execPath, [RUNNER, ...patterns], { cwd: root, encoding: 'utf8' });
}

const PASSING = "import test from 'node:test';\ntest('passes', () => {});\n";

test('runs every file the glob matches and reports the executed count', async (t) => {
  const root = await fixture(t, {
    'suite/one.test.mjs': PASSING,
    'suite/nested/two.test.mjs':
      "import { describe, it } from 'node:test';\ndescribe('group', () => { it('a', () => {}); it('b', () => {}); });\n",
    'suite/helper.mjs': 'throw new Error("not a test file");\n',
  });
  const result = run(root, ['suite/**/*.test.mjs']);
  assert.equal(result.status, 0, result.stderr);
  // Two files, three tests: the describe block is a suite, not a test.
  assert.match(result.stderr, /3 tests passed across 2 files/u);
});

test('fails when a pattern matches no file, even if another pattern does', async (t) => {
  const root = await fixture(t, { 'suite/one.test.mjs': PASSING });
  const result = run(root, ['suite/*.test.mjs', 'renamed/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No test files matched 'renamed\/\*\.test\.mjs'/u);
  assert.doesNotMatch(result.stdout, /passes/u, 'nothing may run once discovery is short');
});

test('fails when no pattern is given', async (t) => {
  const root = await fixture(t, {});
  const result = run(root, []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /needs at least one glob pattern/u);
});

test('fails when the matched files declare zero tests', async (t) => {
  const root = await fixture(t, { 'suite/empty.test.mjs': '// declares nothing\n' });
  const result = run(root, ['suite/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /zero tests executed/u);
});

test('fails and names a skipped test even though node:test exits 0', async (t) => {
  const root = await fixture(t, {
    'suite/skip.test.mjs': `${PASSING}test('quietly off', { skip: true }, () => {});\n`,
  });
  const result = run(root, ['suite/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skipped tests: .*quietly off/u);
});

test('fails and names a todo test', async (t) => {
  const root = await fixture(t, {
    'suite/todo.test.mjs': `${PASSING}test('later', { todo: true }, () => {});\n`,
  });
  const result = run(root, ['suite/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /todo tests: .*later/u);
});

test('counts subtests in every file across several patterns', async (t) => {
  const root = await fixture(t, {
    'one/a.test.mjs': PASSING,
    'one/b.test.mjs': `${PASSING}test('also passes', async (t) => { await t.test('child', () => {}); });\n`,
    'two/c.test.mjs': PASSING,
  });
  const result = run(root, ['one/*.test.mjs', 'two/*.test.mjs']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /5 tests passed across 3 files/u);
});

test('fails and names a test skipped at run time', async (t) => {
  const root = await fixture(t, {
    'suite/conditional.test.mjs': `${PASSING}test('conditional', (t) => { t.skip('no jq'); });\n`,
  });
  const result = run(root, ['suite/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skipped tests: .*conditional/u);
});

test('fails on a failing test and names a file that cannot load', async (t) => {
  const root = await fixture(t, {
    'suite/a.test.mjs': `${PASSING}test('fails', () => { throw new Error('boom'); });\n`,
    'suite/b.test.mjs': "import './missing.mjs';\n",
  });
  const result = run(root, ['suite/*.test.mjs']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /2 test\(s\) failed/u);
  assert.match(result.stderr, /files that ran no test: .*b\.test\.mjs/u);
});

// node:test marks its file processes with NODE_TEST_CONTEXT, and a nested
// `node --test` (or run()) there reports into the parent instead of running
// its own files. The runner strips it, so it must work from inside a test.
test('runs its own files when launched from inside a node:test process', async (t) => {
  const root = await fixture(t, { 'suite/one.test.mjs': PASSING });
  const result = spawnSync(process.execPath, [RUNNER, 'suite/*.test.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /1 tests passed across 1 files/u);
});

test('discovery ignores node_modules and deduplicates overlapping patterns', async (t) => {
  const root = await fixture(t, {
    'suite/one.test.mjs': PASSING,
    'suite/node_modules/dep/dep.test.mjs': PASSING,
  });
  assert.deepEqual(discoverTestFiles(['suite/**/*.test.mjs', 'suite/*.test.mjs'], root), [
    join('suite', 'one.test.mjs'),
  ]);
});

test('fails and names a matched file that declares no test while its sibling runs', async (t) => {
  const root = await fixture(t, {
    'suite/one.test.mjs': PASSING,
    'suite/emptied.test.mjs': '// every test was deleted\n',
  });
  const result = run(root, ['suite/*.test.mjs']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /files that ran no test: .*emptied\.test\.mjs/u);
  assert.doesNotMatch(result.stderr, /files that ran no test: .*one\.test\.mjs/u);
});

test('the verdict accepts only a run where every file executed tests and nothing skipped', () => {
  const files = ['/r/a.test.mjs'];
  const ran = { '/r/a.test.mjs': 1 };
  assert.deepEqual(censusVerdict({ tests: 1, skipped: [], todo: [], testsByFile: ran }, files), []);
  assert.equal(
    censusVerdict({ tests: 0, skipped: [], todo: [], testsByFile: {} }, files).length,
    2,
  );
  assert.equal(
    censusVerdict({ tests: 4, skipped: ['a'], todo: [], testsByFile: ran }, files).length,
    1,
  );
  assert.equal(
    censusVerdict({ tests: 4, skipped: [], todo: ['b'], testsByFile: ran }, files).length,
    1,
  );
});
