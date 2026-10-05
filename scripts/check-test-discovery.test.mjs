import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPackageDiscovery,
  checkRootWiring,
  CI_SCRIPTS,
  vitestConfigs,
} from './check-test-discovery.mjs';

const wiredRoot = {
  test: 'pnpm run build && pnpm --recursive run test',
  'test:integration': 'pnpm run build && pnpm --recursive run test:integration',
};
const wiredWorkflow = [
  'jobs:',
  '  test:',
  '    steps:',
  '      - run: pnpm run test',
  '  integration:',
  '    steps:',
  '      - name: Run integration',
  '        run: pnpm run test:integration',
].join('\n');

test('CI runs exactly the package test and integration scripts', () => {
  assert.deepEqual(CI_SCRIPTS, ['test', 'test:integration']);
});

test('configs come only from CI-run scripts and keep their script name', () => {
  assert.deepEqual(
    vitestConfigs({
      test: 'vitest run --config vitest.config.ts',
      'test:integration': 'vitest run --config=vitest.integration.config.ts',
      'test:docker': 'vitest run --config vitest.docker.config.ts',
    }),
    {
      configs: [
        { script: 'test', config: 'vitest.config.ts' },
        { script: 'test:integration', config: 'vitest.integration.config.ts' },
      ],
      problems: [],
    },
  );
});

test('a package whose CI scripts do not run Vitest selects nothing', () => {
  assert.deepEqual(vitestConfigs({ test: 'node scripts/run-tests.mjs' }), {
    configs: [],
    problems: [],
  });
});

test('Vitest without an explicit config is a problem, not a silent default', () => {
  const { configs, problems } = vitestConfigs({ test: 'vitest run' });
  assert.deepEqual(configs, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"test" runs Vitest without --config/);
});

test('every file discovered by some config passes', () => {
  assert.deepEqual(
    checkPackageDiscovery({
      name: 'demo',
      testFiles: ['src/a.test.ts', 'src/b.integration.test.ts'],
      configs: [
        { script: 'test', config: 'vitest.config.ts', files: ['src/a.test.ts'] },
        {
          script: 'test:integration',
          config: 'vitest.integration.config.ts',
          files: ['src/b.integration.test.ts'],
        },
      ],
    }),
    [],
  );
});

test('a file excluded by every CI config fails and names itself', () => {
  const problems = checkPackageDiscovery({
    name: 'demo',
    testFiles: ['src/a.test.ts', 'src/b.integration.test.ts'],
    configs: [{ script: 'test', config: 'vitest.config.ts', files: ['src/a.test.ts'] }],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^demo: src\/b\.integration\.test\.ts is not discovered/);
});

test('a config that discovers zero files fails even when nothing else is missing', () => {
  const problems = checkPackageDiscovery({
    name: 'demo',
    testFiles: ['src/a.test.ts'],
    configs: [
      { script: 'test', config: 'vitest.config.ts', files: ['src/a.test.ts'] },
      { script: 'test:integration', config: 'vitest.integration.config.ts', files: [] },
    ],
  });
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /vitest\.integration\.config\.ts \(script "test:integration"\) discovers zero/,
  );
});

test('fully wired root scripts and workflow pass', () => {
  assert.deepEqual(checkRootWiring({ rootScripts: wiredRoot, workflow: wiredWorkflow }), []);
});

test('a missing root integration script fails', () => {
  const problems = checkRootWiring({
    rootScripts: { test: wiredRoot.test },
    workflow: wiredWorkflow,
  });
  assert.deepEqual(problems, [
    'root script "test:integration" must run "pnpm --recursive run test:integration".',
  ]);
});

test('a root script that runs a different recursive script does not count', () => {
  const problems = checkRootWiring({
    rootScripts: { ...wiredRoot, 'test:integration': 'pnpm --recursive run test:integration-old' },
    workflow: wiredWorkflow,
  });
  assert.equal(problems.length, 1);
});

test('a workflow that no longer calls the integration script fails', () => {
  const problems = checkRootWiring({
    rootScripts: wiredRoot,
    workflow: wiredWorkflow.replace('pnpm run test:integration', 'echo skipped'),
  });
  assert.deepEqual(problems, [
    '.github/workflows/ci.yml has no step "run: pnpm run test:integration".',
  ]);
});
