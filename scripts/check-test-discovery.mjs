// Fails when a test file sits where no runner that CI invokes would find it.
//
// Each runner discovers tests by its own pattern: Vitest by the config a
// package script names, node:test by a glob on a workflow line. A file
// outside every pattern (a `*.spec.ts` beside `*.test.ts` files, a test under
// `test/`, a suite whose config no CI script runs) is silently never executed,
// and pnpm exits 0 when no package has a recursively run script. This check
// lists every test file in the checkout and fails when:
//   - no runner that CI invokes claims a test file;
//   - a Vitest config behind a CI script discovers zero files (`vitest list`
//     exits 0 on an empty match, unlike `vitest run`);
//   - a CI script runs Vitest without --config, so its discovery cannot be
//     checked against the config that actually runs;
//   - the root package.json or ci.yml stops running a CI_SCRIPTS entry;
//   - a declared runner's wiring text disappears, or it matches no file;
//   - a Playwright fixture spec is named by no test that runs.
//
// Package Vitest runners are derived from each package's CI_SCRIPTS (and any
// scripts/*.mjs they launch) by asking Vitest which files it discovers, so
// they cannot drift. Every other runner is declared in RUNNERS below with the
// literal command text that wires it into CI.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, matchesGlob, relative } from 'node:path';
import { cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/u;

/** The package scripts that root scripts run across the workspace in CI. */
export const CI_SCRIPTS = ['test', 'test:integration'];

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
    reason:
      'Tests for the scripts in scripts/, including this check and the node:test runner; run by glob in the deps job.',
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
      'Helpers behind the Docker demo and consumer preparation. They need no Docker, only bash, jq, Node and the built workspace, so they run once in CI Package Tests after its build.',
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
    discovers: ['e2e/sut/src/**/*.test.ts'],
    wiredBy: [
      { file: 'e2e/sut/tsconfig.json', text: '"include": ["src/**/*.ts"]' },
      {
        file: 'e2e/sut/package.json',
        text: "node ../../scripts/run-node-tests.mjs 'dist/**/*.test.js'",
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
      'Compiled with tsconfig.test.json and run by node:test; the Vitest config excludes src/cli.',
    discovers: ['packages/capsule/src/cli/**/*.test.ts'],
    wiredBy: [
      { file: 'packages/capsule/package.json', text: '"test": "node scripts/run-tests.mjs"' },
      { file: 'packages/capsule/tsconfig.test.json', text: '"include": ["src/**/*.ts"]' },
      { file: 'packages/capsule/scripts/run-tests.mjs', text: "testsIn(join(output, 'cli'))" },
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
    ],
  },
];

// Playwright specs that Vitest tests launch by name through a nested
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

const VITEST_RUN = /\bvitest['"]?,?\s*['"]?run\b/u;
const CONFIG_FLAG = /--config['",=\s]+([\w.-]+\.config\.[cm]?[jt]s)\b/gu;
const EXCLUDE_FLAG = /--exclude['",=\s]+([^'"\s]+)/gu;
const LAUNCHED_SCRIPT = /\bnode (scripts\/[\w./-]+\.mjs)\b/gu;

/**
 * The Vitest runs behind a package's CI scripts. Each script is read with any
 * repository script it launches (`node scripts/<name>.mjs`), because Capsule
 * builds its Vitest argv there. A CI script that runs Vitest without naming a
 * config is a problem: its discovery cannot be checked.
 */
export function vitestInvocations(scripts, readLaunched) {
  const invocations = [];
  const problems = [];
  for (const name of CI_SCRIPTS) {
    const command = scripts[name];
    if (typeof command !== 'string') {
      continue;
    }
    const texts = [command];
    for (const match of command.matchAll(LAUNCHED_SCRIPT)) {
      texts.push(readLaunched(match[1]));
    }
    for (const text of texts) {
      if (!VITEST_RUN.test(text)) {
        continue;
      }
      const configs = [...text.matchAll(CONFIG_FLAG)].map((match) => match[1]);
      if (configs.length === 0) {
        problems.push(`script "${name}" runs Vitest without --config; name the config explicitly.`);
        continue;
      }
      const excludes = [...text.matchAll(EXCLUDE_FLAG)].map((match) => match[1]);
      for (const config of new Set(configs)) {
        invocations.push({ script: name, config, excludes });
      }
    }
  }
  return { invocations, problems };
}

const escape = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/**
 * Package scripts only run in CI if a root script runs each one recursively
 * and ci.yml calls that root script as a step.
 */
export function checkRootWiring({ rootScripts, workflow }) {
  const problems = [];
  for (const name of CI_SCRIPTS) {
    const command = rootScripts[name];
    const recursive = new RegExp(String.raw`pnpm --recursive run ${escape(name)}(\s|$)`, 'u');
    if (typeof command !== 'string' || !recursive.test(command)) {
      problems.push(`root script "${name}" must run "pnpm --recursive run ${name}".`);
    }
    const step = new RegExp(String.raw`^\s*(?:-\s+)?run:\s*pnpm run ${escape(name)}\s*$`, 'mu');
    if (!step.test(workflow)) {
      problems.push(`.github/workflows/ci.yml has no step "run: pnpm run ${name}".`);
    }
  }
  return problems;
}

const execFileAsync = promisify(execFile);

/** Asks the package's own Vitest which files a run would execute, without running them. */
export async function listWithVitest(packageDirectory, args) {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'vitest', 'list', '--filesOnly', '--json', ...args],
    { cwd: packageDirectory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const entries = JSON.parse(stdout);
  if (!Array.isArray(entries)) {
    throw new Error(`vitest list printed non-array JSON in ${packageDirectory}`);
  }
  return entries.map((entry) => entry.file);
}

export async function vitestRunners(root, listVitest = listWithVitest) {
  const runners = [];
  const problems = [];
  const packagesDirectory = join(root, 'packages');
  if (!existsSync(packagesDirectory)) {
    return { runners, problems };
  }
  const realRoot = realpathSync(root);
  const pending = [];
  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const packageDirectory = `packages/${entry.name}`;
    const manifestPath = join(root, packageDirectory, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const scripts = manifest.scripts === undefined ? {} : manifest.scripts;
    const selection = vitestInvocations(scripts, (path) =>
      readFileSync(join(root, packageDirectory, path), 'utf8'),
    );
    problems.push(...selection.problems.map((problem) => `${packageDirectory}: ${problem}`));
    for (const { script, config, excludes } of selection.invocations) {
      const args = ['--config', config, ...excludes.flatMap((glob) => ['--exclude', glob])];
      const name = `${packageDirectory} vitest ${config} (script "${script}")`;
      pending.push(
        listVitest(join(root, packageDirectory), args).then((discovered) => {
          const files = new Set(
            discovered.map((file) => relative(realRoot, file).split(/[\\/]/u).join('/')),
          );
          if (files.size === 0) {
            problems.push(`${name}: discovers zero test files.`);
          }
          runners.push({ name, files });
        }),
      );
    }
  }
  await Promise.all(pending);
  return { runners, problems: problems.sort() };
}

function vitestDiscovers(runner, file) {
  return runner.files.has(file);
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

export async function checkTestDiscovery({
  root,
  files: unsorted,
  runners = RUNNERS,
  listVitest = listWithVitest,
  report = () => {},
}) {
  const files = [...unsorted].sort();
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const problems = checkRootWiring({
    rootScripts: JSON.parse(read('package.json')).scripts,
    workflow: read('.github/workflows/ci.yml'),
  });

  for (const runner of runners) {
    for (const { file, text } of runner.wiredBy) {
      if (!existsSync(join(root, file)) || !read(file).includes(text)) {
        problems.push(`${runner.name}: ${file} no longer contains \`${text}\`; update RUNNERS.`);
      }
    }
  }

  const { runners: vitest, problems: vitestProblems } = await vitestRunners(root, listVitest);
  problems.push(...vitestProblems);
  const tests = files.filter((file) => TEST_FILE.test(file));
  const { launched, unreferenced } = launchedSpecs(files, read, vitest);
  for (const file of unreferenced) {
    problems.push(`${file}: ${LAUNCHED_SPECS.name}, but no running test names it.`);
  }

  const claimed = new Map();
  for (const file of tests) {
    const declared = runners.filter((runner) => matchesAny(file, runner.discovers));
    for (const runner of declared) {
      claimed.set(runner.name, (claimed.get(runner.name) ?? 0) + 1);
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
  const summary = [
    ...vitest.map((runner) => `${runner.name}: ${runner.files.size} files`).sort(),
    ...runners.map((runner) => `${runner.name}: ${claimed.get(runner.name) ?? 0} files`),
    `${LAUNCHED_SPECS.name}: ${launched.size} files`,
  ];
  report(summary);
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
  const problems = await checkTestDiscovery({
    root,
    files: checkoutFiles(root),
    report: (summary) => {
      for (const line of summary) {
        console.log(line);
      }
    },
  });
  for (const problem of problems) {
    console.error(problem);
  }
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} test discovery problem(s). Move the file where a runner finds it, wire a runner, or declare one in ${relative(root, fileURLToPath(import.meta.url))}.`,
    );
    process.exitCode = 1;
  } else {
    console.log('Every test file is discovered by a runner that CI invokes.');
  }
}
