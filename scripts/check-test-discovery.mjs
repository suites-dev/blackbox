import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

// Test discovery gate. The CI package lanes run `pnpm --recursive run test`
// and `pnpm --recursive run test:integration`. A package test file
// that no Vitest config behind one of those scripts discovers never runs, and
// nothing reports it: a config `exclude`, a missing script, or a renamed
// suffix each drops tests silently (pnpm exits 0 when no package has the
// script). This script asks Vitest itself which files each of those configs
// discovers and fails when:
//   - a Vitest-run package has a test file under src/ that no config discovers;
//   - a config discovers zero files (`vitest list` exits 0 on an empty match);
//   - a CI script runs Vitest without naming its config, so discovery cannot
//     be checked against the config that actually runs;
//   - the root package.json or ci.yml stops running one of CI_SCRIPTS.
// Packages whose CI scripts do not run Vitest (the CLI and Capsule compile
// their tests and use Node's runner) are out of scope. Usage:
//   node scripts/check-test-discovery.mjs

/** The package scripts the CI workflow runs across the workspace. */
export const CI_SCRIPTS = ['test', 'test:integration'];

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const VITEST_RUN = /\bvitest\s+run\b/;
const CONFIG_FLAG = /--config[\s=](\S+)/;

/**
 * The Vitest configs a package's CI scripts run, or a problem for a CI script
 * that runs Vitest without an explicit `--config`.
 */
export function vitestConfigs(scripts) {
  const configs = [];
  const problems = [];
  for (const name of CI_SCRIPTS) {
    const command = scripts[name];
    if (typeof command !== 'string' || !VITEST_RUN.test(command)) {
      continue;
    }
    const match = CONFIG_FLAG.exec(command);
    if (match === null) {
      problems.push(`script "${name}" runs Vitest without --config; name the config explicitly.`);
      continue;
    }
    configs.push({ script: name, config: match[1] });
  }
  return { configs, problems };
}

/**
 * Pure verdict over one package. `testFiles` are package-relative paths found
 * on disk; each config carries the package-relative paths Vitest discovered.
 */
export function checkPackageDiscovery({ name, testFiles, configs }) {
  const problems = [];
  const discovered = new Set();
  for (const { script, config, files } of configs) {
    if (files.length === 0) {
      problems.push(`${name}: ${config} (script "${script}") discovers zero test files.`);
    }
    for (const file of files) {
      discovered.add(file);
    }
  }
  for (const file of testFiles) {
    if (!discovered.has(file)) {
      problems.push(
        `${name}: ${file} is not discovered by any CI-run Vitest config (${CI_SCRIPTS.join(', ')}).`,
      );
    }
  }
  return problems;
}

function testFilesUnder(packageDirectory) {
  const source = join(packageDirectory, 'src');
  if (!existsSync(source)) {
    return [];
  }
  return readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEST_FILE.test(entry.name))
    .map((entry) => relative(packageDirectory, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split('/').includes('node_modules'))
    .sort();
}

function listDiscovered(packageDirectory, config) {
  const result = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'list', '--filesOnly', '--json', '--config', config],
    { cwd: packageDirectory, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `vitest list failed in ${packageDirectory} for ${config} (exit ${String(result.status)}):\n${result.stderr}`,
    );
  }
  const entries = JSON.parse(result.stdout);
  if (!Array.isArray(entries)) {
    throw new Error(`vitest list printed non-array JSON in ${packageDirectory} for ${config}`);
  }
  return entries.map((entry) => relative(packageDirectory, entry.file)).sort();
}

const escape = (text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * The per-package verdict only holds if CI really runs CI_SCRIPTS in every
 * package: each must have a root script that runs it recursively, and the CI
 * workflow must call that root script as a step.
 */
export function checkRootWiring({ rootScripts, workflow }) {
  const problems = [];
  for (const name of CI_SCRIPTS) {
    const command = rootScripts[name];
    const recursive = new RegExp(String.raw`pnpm --recursive run ${escape(name)}(\s|$)`);
    if (typeof command !== 'string' || !recursive.test(command)) {
      problems.push(`root script "${name}" must run "pnpm --recursive run ${name}".`);
    }
    const step = new RegExp(String.raw`^\s*(?:-\s+)?run:\s*pnpm run ${escape(name)}\s*$`, 'm');
    if (!step.test(workflow)) {
      problems.push(`.github/workflows/ci.yml has no step "run: pnpm run ${name}".`);
    }
  }
  return problems;
}

export function checkWorkspace(root) {
  const packagesDirectory = join(root, 'packages');
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const problems = checkRootWiring({
    rootScripts: rootManifest.scripts,
    workflow: readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'),
  });
  const summary = [];
  for (const entry of readdirSync(packagesDirectory, { withFileTypes: true })) {
    const packageDirectory = join(packagesDirectory, entry.name);
    const manifestPath = join(packageDirectory, 'package.json');
    if (!entry.isDirectory() || !existsSync(manifestPath)) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const name = typeof manifest.name === 'string' ? manifest.name : entry.name;
    const scripts =
      typeof manifest.scripts === 'object' && manifest.scripts !== null ? manifest.scripts : {};
    const selection = vitestConfigs(scripts);
    problems.push(...selection.problems.map((problem) => `${name}: ${problem}`));
    if (selection.configs.length === 0) {
      continue;
    }
    const configs = selection.configs.map(({ script, config }) => ({
      script,
      config,
      files: listDiscovered(packageDirectory, config),
    }));
    const testFiles = testFilesUnder(packageDirectory);
    problems.push(...checkPackageDiscovery({ name, testFiles, configs }));
    summary.push(
      `${name}: ${testFiles.length} test files; ${configs
        .map(({ script, files }) => `${script}=${files.length}`)
        .join(', ')}`,
    );
  }
  if (summary.length === 0) {
    problems.push('no package runs Vitest from a CI script; the workspace layout changed.');
  }
  return { problems, summary };
}

if (argv[1] !== undefined && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, summary } = checkWorkspace(cwd());
  for (const line of summary) {
    console.log(line);
  }
  if (problems.length > 0) {
    console.error(`\nTest discovery check failed (${problems.length}):`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    exit(1);
  }
  console.log('\nEvery Vitest test file is discovered by a CI-run config.');
}
