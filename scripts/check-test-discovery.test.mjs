import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { RUNNERS, checkTestDiscovery } from './check-test-discovery.mjs';

const VITEST_PACKAGE = {
  'packages/alpha/package.json': JSON.stringify({
    scripts: { test: 'vitest run --config vitest.config.mjs' },
  }),
  'packages/alpha/vitest.config.mjs':
    "export default { test: { include: ['src/**/*.test.ts'], exclude: ['src/**/*.integration.test.ts'] } };\n",
  'packages/alpha/src/unit.test.ts': '',
};

async function fixture(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'check-test-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return { root, files: Object.keys(files) };
}

async function problemsFor(t, files, runners = []) {
  const checkout = await fixture(t, files);
  return checkTestDiscovery({ ...checkout, runners });
}

test('accepts a checkout where the package test script discovers every test', async (t) => {
  assert.deepEqual(await problemsFor(t, VITEST_PACKAGE), []);
});

test('flags a spec file beside tests that the vitest include does not match', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'packages/alpha/src/unit.spec.ts': '',
  });
  assert.deepEqual(problems, [
    'packages/alpha/src/unit.spec.ts: no runner that CI invokes discovers this test file.',
  ]);
});

test('flags a test placed under test/ instead of src/', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'packages/alpha/test/unit.test.ts': '',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^packages\/alpha\/test\/unit\.test\.ts: no runner/u);
});

test('flags tests whose vitest config the test script never runs, until it does', async (t) => {
  const integration = {
    ...VITEST_PACKAGE,
    'packages/alpha/vitest.integration.config.mjs':
      "export default { test: { include: ['src/**/*.integration.test.ts'] } };\n",
    'packages/alpha/src/slow.integration.test.ts': '',
  };
  const unwired = await problemsFor(t, integration);
  assert.deepEqual(unwired, [
    'packages/alpha/src/slow.integration.test.ts: no runner that CI invokes discovers this test file.',
  ]);
  const wired = await problemsFor(t, {
    ...integration,
    'packages/alpha/package.json': JSON.stringify({
      scripts: {
        test: 'vitest run --config vitest.config.mjs && vitest run --config vitest.integration.config.mjs',
      },
    }),
  });
  assert.deepEqual(wired, []);
});

test('flags every test of a package that has no test script', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'packages/alpha/package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }),
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^packages\/alpha\/src\/unit\.test\.ts: no runner/u);
});

test('reads the vitest config and CLI excludes from a script the test script launches', async (t) => {
  const problems = await problemsFor(t, {
    'packages/alpha/package.json': JSON.stringify({
      scripts: { test: 'node scripts/run-tests.mjs' },
    }),
    'packages/alpha/scripts/run-tests.mjs':
      "run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.config.mjs', '--exclude', 'src/cli/**/*.test.ts']);\n",
    'packages/alpha/vitest.config.mjs':
      "export default { test: { include: ['src/**/*.test.ts'] } };\n",
    'packages/alpha/src/unit.test.ts': '',
    'packages/alpha/src/cli/command.test.ts': '',
  });
  assert.deepEqual(problems, [
    'packages/alpha/src/cli/command.test.ts: no runner that CI invokes discovers this test file.',
  ]);
});

const DECLARED = {
  name: 'helper scripts',
  reason: 'fixture',
  discovers: ['tools/*.test.mjs'],
  wiredBy: [{ file: 'ci.yml', text: "run-node-tests.mjs 'tools/*.test.mjs'" }],
};

test('a declared runner claims its files while its wiring text is present', async (t) => {
  const files = {
    'ci.yml': "run: node run-node-tests.mjs 'tools/*.test.mjs'\n",
    'tools/a.test.mjs': '',
  };
  assert.deepEqual(await problemsFor(t, files, [DECLARED]), []);
});

test('a declared runner fails once the workflow no longer wires it', async (t) => {
  const files = { 'ci.yml': 'run: node --test tools/a.test.mjs\n', 'tools/a.test.mjs': '' };
  assert.deepEqual(await problemsFor(t, files, [DECLARED]), [
    "helper scripts: ci.yml no longer contains `run-node-tests.mjs 'tools/*.test.mjs'`; update RUNNERS.",
  ]);
});

test('a declared runner that matches no test file is reported as stale', async (t) => {
  const files = { 'ci.yml': "run: node run-node-tests.mjs 'tools/*.test.mjs'\n" };
  assert.deepEqual(await problemsFor(t, files, [DECLARED]), [
    'helper scripts: declared, but matches no test file; remove or fix it in RUNNERS.',
  ]);
});

const PLAYWRIGHT_PACKAGE = {
  'packages/playwright/package.json': JSON.stringify({
    scripts: { test: 'vitest run --config vitest.config.mjs' },
  }),
  'packages/playwright/vitest.config.mjs':
    "export default { test: { include: ['src/**/*.test.ts'] } };\n",
};

test('a launched spec is accepted when a running test names it directly or through its config', async (t) => {
  const problems = await problemsFor(t, {
    ...PLAYWRIGHT_PACKAGE,
    'packages/playwright/src/sandbox.test.ts':
      "runPlaywright({ testFile: 'happy.spec.ts' });\nimport './testing/helpers.spec.js';\nrunPlaywright({ configFile: 'timeout.config.ts' });\n",
    'packages/playwright/src/testing/happy.spec.ts': '',
    'packages/playwright/src/testing/helpers.spec.ts': '',
    'packages/playwright/src/testing/timeout.config.ts':
      "export default { testMatch: 'slow.spec.ts' };\n",
    'packages/playwright/src/testing/slow.spec.ts': '',
  });
  assert.deepEqual(problems, []);
});

test('a launched spec that no running test names is reported', async (t) => {
  const problems = await problemsFor(t, {
    ...PLAYWRIGHT_PACKAGE,
    'packages/playwright/src/sandbox.test.ts': "runPlaywright({ testFile: 'happy.spec.ts' });\n",
    'packages/playwright/src/testing/happy.spec.ts': '',
    'packages/playwright/src/testing/unhappy.spec.ts': '',
    // Named only by a config that no test launches.
    'packages/playwright/src/testing/orphan.config.ts':
      "export default { testMatch: 'orphaned.spec.ts' };\n",
    'packages/playwright/src/testing/orphaned.spec.ts': '',
    // A longer name that contains the spec name does not count.
    'packages/playwright/src/other.test.ts':
      "const files = ['not-unhappy.spec.ts', 'unhappy.spec.ts.bak'];\n",
  });
  assert.deepEqual(problems, [
    'packages/playwright/src/testing/orphaned.spec.ts: Playwright fixture specs launched from vitest tests, but no running test names it.',
    'packages/playwright/src/testing/unhappy.spec.ts: Playwright fixture specs launched from vitest tests, but no running test names it.',
  ]);
});

test('a spec named only by a test that vitest does not run is reported', async (t) => {
  const problems = await problemsFor(t, {
    ...PLAYWRIGHT_PACKAGE,
    'packages/playwright/src/unit.test.ts': '',
    'packages/playwright/test/launcher.test.ts': "runPlaywright({ testFile: 'happy.spec.ts' });\n",
    'packages/playwright/src/testing/happy.spec.ts': '',
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /happy\.spec\.ts: Playwright fixture specs/u);
  assert.match(problems[1], /test\/launcher\.test\.ts: no runner/u);
});

test('every declared runner explains why it is outside the package vitest configs', () => {
  for (const runner of RUNNERS) {
    assert.ok(runner.reason.length > 0, runner.name);
    assert.ok(runner.discovers.length > 0, runner.name);
    assert.ok(runner.wiredBy.length > 0, runner.name);
  }
});
