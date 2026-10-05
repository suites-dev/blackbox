import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CI_SCRIPTS,
  RUNNERS,
  checkRootWiring,
  checkTestDiscovery,
  vitestInvocations,
} from './check-test-discovery.mjs';

// Fixture packages have no node_modules, so discovery runs the repository's
// own Vitest CLI in each fixture package: the same `vitest list` the check
// runs, not a reimplementation of its matching.
const VITEST_CLI = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

async function listWithRepositoryVitest(packageDirectory, args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [VITEST_CLI, 'list', '--filesOnly', '--json', ...args],
    { cwd: packageDirectory, encoding: 'utf8' },
  );
  return JSON.parse(stdout).map((entry) => entry.file);
}

const WIRED_ROOT_SCRIPTS = {
  test: 'pnpm run build && pnpm --recursive run test',
  'test:integration': 'pnpm run build && pnpm --recursive run test:integration',
};
const WIRED_WORKFLOW = [
  'jobs:',
  '  test:',
  '    steps:',
  '      - run: pnpm run test',
  '  integration:',
  '    steps:',
  '      - name: Run integration',
  '        run: pnpm run test:integration',
].join('\n');
const WIRED_ROOT = {
  'package.json': JSON.stringify({ scripts: WIRED_ROOT_SCRIPTS }),
  '.github/workflows/ci.yml': `${WIRED_WORKFLOW}\n`,
};

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
  const all = { ...WIRED_ROOT, ...files };
  for (const [path, contents] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return { root, files: Object.keys(all) };
}

async function problemsFor(t, files, runners = []) {
  const checkout = await fixture(t, files);
  return checkTestDiscovery({ ...checkout, runners, listVitest: listWithRepositoryVitest });
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

const INTEGRATION_PACKAGE = {
  ...VITEST_PACKAGE,
  'packages/alpha/vitest.integration.config.mjs':
    "export default { test: { include: ['src/**/*.integration.test.ts'] } };\n",
  'packages/alpha/src/slow.integration.test.ts': '',
};

test('flags tests whose vitest config no CI script runs', async (t) => {
  const problems = await problemsFor(t, {
    ...INTEGRATION_PACKAGE,
    'packages/alpha/package.json': JSON.stringify({
      scripts: {
        test: 'vitest run --config vitest.config.mjs',
        // Not a CI script: nothing at the root runs it recursively.
        'test:slow': 'vitest run --config vitest.integration.config.mjs',
      },
    }),
  });
  assert.deepEqual(problems, [
    'packages/alpha/src/slow.integration.test.ts: no runner that CI invokes discovers this test file.',
  ]);
});

test('accepts integration tests once the test:integration script runs their config', async (t) => {
  const problems = await problemsFor(t, {
    ...INTEGRATION_PACKAGE,
    'packages/alpha/package.json': JSON.stringify({
      scripts: {
        test: 'vitest run --config vitest.config.mjs',
        'test:integration': 'vitest run --config vitest.integration.config.mjs',
      },
    }),
  });
  assert.deepEqual(problems, []);
});

test('flags a CI-run config that discovers zero files', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'packages/alpha/package.json': JSON.stringify({
      scripts: {
        test: 'vitest run --config vitest.config.mjs',
        'test:integration': 'vitest run --config vitest.integration.config.mjs',
      },
    }),
    'packages/alpha/vitest.integration.config.mjs':
      "export default { test: { include: ['src/**/*.integration.test.ts'] } };\n",
  });
  assert.deepEqual(problems, [
    'packages/alpha vitest vitest.integration.config.mjs (script "test:integration"): discovers zero test files.',
  ]);
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

test('flags a CI script that runs Vitest without naming its config', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'packages/alpha/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
  });
  assert.deepEqual(problems, [
    'packages/alpha: script "test" runs Vitest without --config; name the config explicitly.',
    'packages/alpha/src/unit.test.ts: no runner that CI invokes discovers this test file.',
  ]);
});

test('flags root wiring that stops running a CI script across the workspace', async (t) => {
  const problems = await problemsFor(t, {
    ...VITEST_PACKAGE,
    'package.json': JSON.stringify({ scripts: { test: WIRED_ROOT_SCRIPTS.test } }),
  });
  assert.deepEqual(problems, [
    'root script "test:integration" must run "pnpm --recursive run test:integration".',
  ]);
});

test('CI runs exactly the package test and integration scripts', () => {
  assert.deepEqual(CI_SCRIPTS, ['test', 'test:integration']);
});

test('configs come only from CI-run scripts and keep their script name', () => {
  const unread = () => assert.fail('no script is launched');
  assert.deepEqual(
    vitestInvocations(
      {
        test: 'vitest run --config vitest.config.ts',
        'test:integration': 'vitest run --config=vitest.integration.config.ts',
        'test:docker': 'vitest run --config vitest.docker.config.ts',
      },
      unread,
    ),
    {
      invocations: [
        { script: 'test', config: 'vitest.config.ts', excludes: [] },
        { script: 'test:integration', config: 'vitest.integration.config.ts', excludes: [] },
      ],
      problems: [],
    },
  );
});

test('a package whose CI scripts do not run Vitest selects nothing', () => {
  assert.deepEqual(
    vitestInvocations({ test: 'node scripts/run-tests.mjs' }, () => 'spawn(node, ["--test"])'),
    { invocations: [], problems: [] },
  );
});

test('fully wired root scripts and workflow pass', () => {
  assert.deepEqual(
    checkRootWiring({ rootScripts: WIRED_ROOT_SCRIPTS, workflow: WIRED_WORKFLOW }),
    [],
  );
});

test('a root script that runs a different recursive script does not count', () => {
  const problems = checkRootWiring({
    rootScripts: {
      ...WIRED_ROOT_SCRIPTS,
      'test:integration': 'pnpm --recursive run test:integration-old',
    },
    workflow: WIRED_WORKFLOW,
  });
  assert.deepEqual(problems, [
    'root script "test:integration" must run "pnpm --recursive run test:integration".',
  ]);
});

test('a workflow that no longer calls the integration script fails', () => {
  const problems = checkRootWiring({
    rootScripts: WIRED_ROOT_SCRIPTS,
    workflow: WIRED_WORKFLOW.replace('pnpm run test:integration', 'echo skipped'),
  });
  assert.deepEqual(problems, [
    '.github/workflows/ci.yml has no step "run: pnpm run test:integration".',
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
