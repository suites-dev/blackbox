// Runs every Docker-backed sandbox test and fails unless each one ran and passed.
//
// The Docker tests are wrapped in describe.skipIf so `pnpm test` stays green on
// a machine without Docker. That same skip would let this run pass with nothing
// executed, so a green exit code from Vitest is not trusted on its own: the
// JSON report must show every discovered file with at least one test, and every
// test in it passed. Zero discovered files is a failure too.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCKER_TEST_SUFFIX = '.docker.test.ts';
const packageDirectory = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = join(packageDirectory, 'src');

async function discoverDockerTests() {
  const entries = await readdir(sourceDirectory, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(DOCKER_TEST_SUFFIX))
    .map((entry) => resolve(sourceDirectory, entry))
    .sort();
}

function runVitest(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm', ['exec', 'vitest', ...args], {
      cwd: packageDirectory,
      stdio: 'inherit',
      env: { ...process.env, BLACKBOX_SANDBOX_DOCKER_TEST: '1' },
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

function verifyReport(discovered, report) {
  const problems = [];
  const results = new Map();
  for (const result of report.testResults) {
    results.set(resolve(result.name), result);
  }
  let tests = 0;
  for (const file of discovered) {
    const name = relative(packageDirectory, file);
    const result = results.get(file);
    if (result === undefined) {
      problems.push(`${name}: not in the Vitest report`);
      continue;
    }
    if (result.assertionResults.length === 0) {
      problems.push(`${name}: no tests were collected`);
    }
    for (const assertion of result.assertionResults) {
      tests += 1;
      if (assertion.status !== 'passed') {
        problems.push(`${name}: "${assertion.fullName}" is ${assertion.status}`);
      }
    }
  }
  return { problems, tests };
}

const discovered = await discoverDockerTests();
if (discovered.length === 0) {
  console.error(
    `No *${DOCKER_TEST_SUFFIX} files were found under ${relative(packageDirectory, sourceDirectory)}/.`,
  );
  process.exit(1);
}

const output = await mkdtemp(join(tmpdir(), `blackbox-sandbox-docker-${process.pid}-`));
try {
  const reportPath = join(output, 'report.json');
  const run = await runVitest([
    'run',
    '--config',
    'vitest.config.ts',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
    ...discovered.map((file) => relative(packageDirectory, file)),
  ]);
  if (run.code !== 0) {
    console.error(
      `Vitest exited with ${run.code === null ? `signal ${run.signal}` : `code ${run.code}`}.`,
    );
    process.exitCode = run.code === null ? 1 : run.code;
  } else {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    const { problems, tests } = verifyReport(discovered, report);
    if (problems.length > 0) {
      console.error('Sandbox Docker tests must all run and pass; this run did not:');
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
      process.exitCode = 1;
    } else {
      console.log(
        `Sandbox Docker tests: ${tests} passed across ${discovered.length} files, none skipped.`,
      );
    }
  }
} finally {
  await rm(output, { recursive: true, force: true });
}
