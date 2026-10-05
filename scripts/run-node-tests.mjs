// Runs node:test files selected by glob and fails when discovery or execution
// comes back empty. `node --test <glob>` exits 0 with zero tests when a glob
// matches nothing, so a renamed directory or a typo silently retires a suite.
// This wrapper refuses that: every pattern must match at least one file, at
// least one test must execute in every matched file, and no test may be
// skipped or marked todo.
//
// Usage: node scripts/run-node-tests.mjs '<glob>' ['<glob>' ...]
// Quote each glob so the runner, not the shell, expands it.
import { spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cwd, execPath } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CENSUS_REPORTER = pathToFileURL(
  fileURLToPath(new URL('./node-test-census.mjs', import.meta.url)),
).href;

export function discoverTestFiles(patterns, root) {
  if (patterns.length === 0) {
    throw new Error('run-node-tests needs at least one glob pattern');
  }
  const files = new Set();
  const empty = [];
  for (const pattern of patterns) {
    const matches = globSync(pattern, { cwd: root }).filter(
      (file) => !file.split(/[\\/]/u).includes('node_modules'),
    );
    if (matches.length === 0) {
      empty.push(pattern);
    }
    for (const match of matches) {
      files.add(match);
    }
  }
  if (empty.length > 0) {
    throw new Error(
      `No test files matched ${empty.map((pattern) => `'${pattern}'`).join(', ')} under ${root}`,
    );
  }
  return [...files].sort();
}

export function censusVerdict(census, files) {
  const problems = [];
  if (census.tests === 0) {
    problems.push('zero tests executed');
  }
  const silent = files.filter((file) => census.testsByFile[file] === undefined);
  if (silent.length > 0) {
    problems.push(`files that ran no test: ${silent.join(', ')}`);
  }
  if (census.skipped.length > 0) {
    problems.push(`skipped tests: ${census.skipped.join('; ')}`);
  }
  if (census.todo.length > 0) {
    problems.push(`todo tests: ${census.todo.join('; ')}`);
  }
  return problems;
}

// Inside another node:test run, NODE_TEST_CONTEXT makes `node --test` act as a
// reporting child of that run: it ignores --test-reporter and the census file
// is never written. The wrapper always owns its own run.
function ownRunEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function main(patterns) {
  const root = cwd();
  const files = discoverTestFiles(patterns, root);
  const scratch = mkdtempSync(join(tmpdir(), 'blackbox-node-tests-'));
  const censusFile = join(scratch, 'census.json');
  try {
    const visibleReporter = process.stdout.isTTY ? 'spec' : 'tap';
    const result = spawnSync(
      execPath,
      [
        '--test',
        `--test-reporter=${visibleReporter}`,
        '--test-reporter-destination=stdout',
        `--test-reporter=${CENSUS_REPORTER}`,
        `--test-reporter-destination=${censusFile}`,
        ...files,
      ],
      { cwd: root, stdio: 'inherit', env: ownRunEnvironment() },
    );
    if (result.error !== undefined) {
      throw result.error;
    }
    if (result.status !== 0) {
      return result.status === null ? 1 : result.status;
    }
    const census = JSON.parse(readFileSync(censusFile, 'utf8'));
    const problems = censusVerdict(
      census,
      files.map((file) => resolve(root, file)),
    );
    if (problems.length > 0) {
      console.error(`run-node-tests: ${files.length} files, but ${problems.join('; ')}`);
      return 1;
    }
    console.error(`run-node-tests: ${census.tests} tests passed across ${files.length} files`);
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`run-node-tests: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
