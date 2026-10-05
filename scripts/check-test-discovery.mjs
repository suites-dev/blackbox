// Fails when a test file sits where no runner that CI invokes would find it.
//
// Each package runner discovers tests by its own pattern: vitest by the
// include/exclude of the config its `test` script names, node:test by a glob
// on a workflow line. A file outside every pattern (a `*.spec.ts` beside
// `*.test.ts` files, a test under `test/`, a suite whose config is never run)
// is silently never executed. This check lists every test file in the
// checkout and requires each one to be claimed by a runner.
//
// Package vitest runners are derived from each package's `test` script, so
// they cannot drift. Every other runner is declared in RUNNERS below with the
// literal command text that wires it into CI; if that text disappears the
// check fails, so a declaration cannot outlive the runner it describes.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, matchesGlob, relative } from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/u;

// Vitest's own defaults, used when a config does not set include or exclude.
const VITEST_DEFAULT_INCLUDE = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const VITEST_DEFAULT_EXCLUDE = ['**/node_modules/**', '**/.git/**'];

// Package tests reach CI through the root `pnpm test`, which runs every
// package's `test` script.
const PACKAGE_TESTS_WIRED_BY = [
  { file: 'package.json', text: '"test": "pnpm run build && pnpm --recursive run test"' },
  { file: '.github/workflows/ci.yml', text: 'run: pnpm run test' },
];

const NODE_TESTS_IN_CI = "node scripts/run-node-tests.mjs '";

export const RUNNERS = [
  {
    name: 'workflow evidence self-tests',
    reason: 'Node scripts the workflows import; run by glob in CI and in the E2E transport lane.',
    discovers: ['.github/scripts/*.test.mjs'],
    wiredBy: [
      { file: '.github/workflows/ci.yml', text: `${NODE_TESTS_IN_CI}.github/scripts/*.test.mjs'` },
      { file: '.github/workflows/e2e.yml', text: `${NODE_TESTS_IN_CI}.github/scripts/*.test.mjs'` },
    ],
  },
  {
    name: 'repository check scripts',
    reason: 'Tests for the scripts in scripts/, including this check; run by glob in the deps job.',
    discovers: ['scripts/*.test.mjs'],
    wiredBy: [{ file: '.github/workflows/ci.yml', text: `${NODE_TESTS_IN_CI}scripts/*.test.mjs'` }],
  },
  {
    name: 'dependency audit policy',
    reason: 'Security policy scripts; run by glob in the security workflow.',
    discovers: ['scripts/security/*.test.mjs'],
    wiredBy: [
      {
        file: '.github/workflows/security.yml',
        text: `${NODE_TESTS_IN_CI}scripts/security/*.test.mjs'`,
      },
    ],
  },
  {
    name: 'demo support and consumer helpers',
    reason:
      'Helpers behind the Docker demo and consumer preparation, tested without Docker in CI Package Tests.',
    discovers: ['demo/support/*.test.mjs', 'scripts/consumer/*.test.mjs'],
    wiredBy: [
      {
        file: '.github/workflows/ci.yml',
        text: `${NODE_TESTS_IN_CI}demo/support/*.test.mjs' 'scripts/consumer/*.test.mjs'`,
      },
    ],
  },
  {
    name: 'E2E lint rules',
    reason: 'Custom ESLint rules for the E2E consumer; e2e/ is not a workspace package.',
    discovers: ['e2e/lint/*.test.mjs'],
    wiredBy: [
      {
        file: 'e2e/package.json',
        text: `"test:lint": "node ../scripts/run-node-tests.mjs 'lint/*.test.mjs'"`,
      },
      { file: '.github/workflows/ci.yml', text: 'run: pnpm --dir e2e run test:lint' },
    ],
  },
  {
    name: 'journey harness',
    reason: 'Harness self-test that runs before the CLI journeys in the E2E workflow.',
    discovers: ['e2e/journeys/journey-harness.test.mjs'],
    wiredBy: [
      { file: 'package.json', text: 'node --test e2e/journeys/journey-harness.test.mjs' },
      { file: '.github/workflows/e2e.yml', text: '-- pnpm test:e2e:journeys' },
    ],
  },
  {
    name: 'system under test units',
    reason:
      'Standalone npm project; tsc compiles src/ to dist/ and the test script runs every emitted test by glob.',
    discovers: ['e2e/sut/src/**/*.test.ts', 'e2e/sut/scripts/**/*.test.mjs'],
    wiredBy: [
      { file: 'e2e/sut/tsconfig.json', text: '"include": ["src/**/*.ts"]' },
      {
        file: 'e2e/sut/package.json',
        text: "node ../../scripts/run-node-tests.mjs 'dist/**/*.test.js' '{dist/**/*.test.js,scripts/**/*.test.mjs}'",
      },
      { file: '.github/workflows/ci.yml', text: 'npm test --prefix e2e/sut' },
    ],
  },
  {
    name: 'E2E Playwright lane',
    reason: 'Playwright system tests; they need Docker and run only in the E2E workflow.',
    discovers: ['e2e/tests/playwright/*.spec.ts'],
    wiredBy: [
      {
        file: 'e2e/playwright.config.ts',
        text: "testDir: join(import.meta.dirname, 'tests', 'playwright')",
      },
      { file: 'e2e/playwright.config.ts', text: "testMatch: '*.spec.ts'" },
      { file: '.github/workflows/e2e.yml', text: '-- pnpm test:e2e:playwright' },
    ],
  },
  {
    name: 'Capsule CLI node tests',
    reason:
      'Compiled with tsconfig.test.json and run by node:test; the vitest config excludes src/cli.',
    discovers: ['packages/capsule/src/cli/**/*.test.ts'],
    wiredBy: [
      { file: 'packages/capsule/package.json', text: '"test": "node scripts/run-tests.mjs"' },
      { file: 'packages/capsule/tsconfig.test.json', text: '"include": ["src/**/*.ts"]' },
      { file: 'packages/capsule/scripts/run-tests.mjs', text: "testsIn(join(output, 'cli'))" },
      ...PACKAGE_TESTS_WIRED_BY,
    ],
  },
  {
    name: 'CLI package node tests',
    reason: 'Compiled with tsconfig.test.json and run by node:test against the built binary.',
    discovers: ['packages/cli/src/**/*.test.ts'],
    wiredBy: [
      { file: 'packages/cli/package.json', text: '"test": "node scripts/run-tests.mjs"' },
      { file: 'packages/cli/tsconfig.test.json', text: '"include": ["src/**/*.ts"]' },
      { file: 'packages/cli/scripts/run-tests.mjs', text: 'const tests = await testsIn(output);' },
      ...PACKAGE_TESTS_WIRED_BY,
    ],
  },
];

// Playwright specs that vitest tests launch by name through a nested
// Playwright run. They are not discovered by any glob, so each must be named by
// a test that runs, directly or through a config file such a test names.
export const LAUNCHED_SPECS = {
  name: 'Playwright fixture specs launched from vitest tests',
  candidates: 'packages/playwright/src/testing/**/*.spec.ts',
  configs: 'packages/playwright/src/testing/**/*.config.ts',
  launchers: 'packages/playwright/src/**/*.test.ts',
};

function matchesAny(file, patterns) {
  return patterns.some((pattern) => matchesGlob(file, pattern));
}

function asList(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return Array.isArray(value) ? value : [value];
}

// The files a package's `test` script runs, read from the script and from any
// repository script it launches with `node scripts/<name>.mjs`.
function packageTestCommands(root, packageDirectory) {
  const manifestPath = join(root, packageDirectory, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const scripts = manifest.scripts === undefined ? {} : manifest.scripts;
  const script = scripts.test;
  if (script === undefined) {
    return [];
  }
  const texts = [script];
  for (const match of script.matchAll(/\bnode (scripts\/[\w./-]+\.mjs)\b/gu)) {
    texts.push(readFileSync(join(root, packageDirectory, match[1]), 'utf8'));
  }
  return texts;
}

export async function vitestRunners(root) {
  const runners = [];
  const packagesDirectory = join(root, 'packages');
  if (!existsSync(packagesDirectory)) {
    return runners;
  }
  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const packageDirectory = `packages/${entry.name}`;
    if (!entry.isDirectory() || !existsSync(join(root, packageDirectory, 'package.json'))) {
      continue;
    }
    const texts = packageTestCommands(root, packageDirectory);
    const joined = texts.join('\n');
    const cliExcludes = [...joined.matchAll(/--exclude['",\s]+([^'"\s]+)/gu)].map(
      (match) => match[1],
    );
    const configs = new Set(
      [...joined.matchAll(/--config['",\s]+([\w.-]+\.config\.[cm]?[jt]s)\b/gu)].map(
        (match) => match[1],
      ),
    );
    for (const config of configs) {
      const module = await import(pathToFileURL(join(root, packageDirectory, config)).href);
      const exported =
        typeof module.default === 'function' ? await module.default({}) : module.default;
      const test = exported.test === undefined ? {} : exported.test;
      runners.push({
        name: `${packageDirectory} vitest (${config})`,
        root: packageDirectory,
        include: asList(test.include, VITEST_DEFAULT_INCLUDE),
        exclude: [...asList(test.exclude, VITEST_DEFAULT_EXCLUDE), ...cliExcludes],
      });
    }
  }
  return runners;
}

function vitestDiscovers(runner, file) {
  if (!file.startsWith(`${runner.root}/`)) {
    return false;
  }
  const local = file.slice(runner.root.length + 1);
  return matchesAny(local, runner.include) && !matchesAny(local, runner.exclude);
}

function namedIn(text, name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}(?![\\w.-])`, 'u').test(text);
}

function launchedSpecs(files, read, vitest) {
  const launchers = files.filter(
    (file) =>
      matchesGlob(file, LAUNCHED_SPECS.launchers) &&
      vitest.some((runner) => vitestDiscovers(runner, file)),
  );
  const launcherText = launchers.map(read).join('\n');
  const configText = files
    .filter(
      (file) => matchesGlob(file, LAUNCHED_SPECS.configs) && namedIn(launcherText, basename(file)),
    )
    .map(read)
    .join('\n');
  const referenceText = `${launcherText}\n${configText}`;
  const launched = new Set();
  const unreferenced = [];
  for (const file of files.filter((candidate) =>
    matchesGlob(candidate, LAUNCHED_SPECS.candidates),
  )) {
    const name = basename(file);
    if (namedIn(referenceText, name) || namedIn(referenceText, name.replace(/\.ts$/u, '.js'))) {
      launched.add(file);
    } else {
      unreferenced.push(file);
    }
  }
  return { launched, unreferenced };
}

export async function checkTestDiscovery({ root, files: unsorted, runners = RUNNERS }) {
  const files = [...unsorted].sort();
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const problems = [];

  for (const runner of runners) {
    for (const { file, text } of runner.wiredBy) {
      if (!existsSync(join(root, file)) || !read(file).includes(text)) {
        problems.push(`${runner.name}: ${file} no longer contains \`${text}\`; update RUNNERS.`);
      }
    }
  }

  const vitest = await vitestRunners(root);
  const tests = files.filter((file) => TEST_FILE.test(file));
  const { launched, unreferenced } = launchedSpecs(files, read, vitest);
  for (const file of unreferenced) {
    problems.push(`${file}: ${LAUNCHED_SPECS.name}, but no running test names it.`);
  }

  const claimed = new Set();
  for (const file of tests) {
    const declared = runners.filter((runner) => matchesAny(file, runner.discovers));
    for (const runner of declared) {
      claimed.add(runner.name);
    }
    if (declared.length > 0 || launched.has(file) || unreferenced.includes(file)) {
      continue;
    }
    if (vitest.some((runner) => vitestDiscovers(runner, file))) {
      continue;
    }
    problems.push(`${file}: no runner that CI invokes discovers this test file.`);
  }

  for (const runner of runners) {
    if (!claimed.has(runner.name)) {
      problems.push(
        `${runner.name}: declared, but matches no test file; remove or fix it in RUNNERS.`,
      );
    }
  }
  return problems;
}

function checkoutFiles(root) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return output
    .split('\0')
    .filter((file) => file.length > 0 && existsSync(join(root, file)))
    .map((file) => file.split(/[\\/]/u).join('/'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = cwd();
  const problems = await checkTestDiscovery({ root, files: checkoutFiles(root) });
  for (const problem of problems) {
    console.error(problem);
  }
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} test discovery problem(s). Move the file where a runner finds it, wire a runner, or declare one in ${relative(root, fileURLToPath(import.meta.url))}.`,
    );
    process.exitCode = 1;
  }
}
