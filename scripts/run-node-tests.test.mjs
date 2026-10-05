import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = resolve(dirname(fileURLToPath(import.meta.url)), 'run-node-tests.mjs');

const passing = "import { test } from 'node:test';\ntest('passes', () => {});\n";

async function project(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'blackbox-run-node-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

// node:test marks its file processes with NODE_TEST_CONTEXT, and run() inside
// such a process skips every file. The runner under test must start clean.
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name !== 'NODE_TEST_CONTEXT'),
);

function runIn(root, patterns) {
  return new Promise((resolvePromise) => {
    const options = { cwd: root, env: environment };
    execFile(process.execPath, [runner, ...patterns], options, (error, stdout, stderr) => {
      const code = error === null ? 0 : error.code;
      resolvePromise({ code, stdout, stderr });
    });
  });
}

void test('passes and counts every test in every matched file', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': passing,
    'one/b.test.mjs': `${passing}test('also passes', async (t) => { await t.test('child', () => {}); });\n`,
    'two/c.test.mjs': passing,
  });
  const result = await runIn(root, ['one/*.test.mjs', 'two/*.test.mjs']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /run-node-tests: 5 test\(s\) across 3 file\(s\)/);
});

void test('fails when any pattern matches no files, even if another one does', async (t) => {
  const root = await project(t, { 'one/a.test.mjs': passing });
  const result = await runIn(root, ['one/*.test.mjs', 'moved/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /pattern moved\/\*\.test\.mjs matched no test files/);
});

void test('fails when no pattern is given', async (t) => {
  const root = await project(t, {});
  const result = await runIn(root, []);
  assert.notEqual(result.code, 0);
});

void test('fails when a matched file defines no tests', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': passing,
    'one/empty.test.mjs': '// every test was deleted\n',
  });
  const result = await runIn(root, ['one/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /one\/empty\.test\.mjs ran no tests/);
});

void test('fails when a test is skipped', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': `${passing}test('skipped', { skip: 'needs docker' }, () => {});\n`,
  });
  const result = await runIn(root, ['one/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /test "skipped" was skipped/);
});

void test('fails when a test is skipped at run time', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': `${passing}test('conditional', (t) => { t.skip('no jq'); });\n`,
  });
  const result = await runIn(root, ['one/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /test "conditional" was skipped/);
});

void test('fails when a test is marked todo', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': `${passing}test('later', { todo: true }, () => {});\n`,
  });
  const result = await runIn(root, ['one/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /test "later" is marked todo/);
});

void test('fails when a test fails or a file cannot load', async (t) => {
  const root = await project(t, {
    'one/a.test.mjs': `${passing}test('fails', () => { throw new Error('boom'); });\n`,
    'one/b.test.mjs': "import './missing.mjs';\n",
  });
  const result = await runIn(root, ['one/*.test.mjs']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /2 test\(s\) failed/);
  assert.match(result.stderr, /one\/b\.test\.mjs ran no tests/);
});
