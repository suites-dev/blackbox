import { globSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { argv, cwd, exit, stderr, stdout } from 'node:process';
import { run } from 'node:test';
import { spec } from 'node:test/reporters';

// Runs node:test files discovered by glob and fails on anything that would
// otherwise pass without proving a test ran. `node --test` exits 0 when a glob
// matches nothing and when a file defines no tests, and it counts skip and todo
// as passing, so a moved directory or a stray skip would turn a CI step green
// silently. This runner refuses each of those. Usage:
//   node scripts/run-node-tests.mjs 'demo/support/*.test.mjs' ...
// Quote the patterns so this script, not the shell, expands them.

const patterns = argv.slice(2);
if (patterns.length === 0) {
  stderr.write('run-node-tests: pass at least one test file glob\n');
  exit(2);
}

const problems = [];
const files = new Set();
for (const pattern of patterns) {
  const matches = globSync(pattern, { cwd: cwd() }).map((match) => resolve(cwd(), match));
  if (matches.length === 0) {
    problems.push(`pattern ${pattern} matched no test files`);
  }
  for (const match of matches) {
    files.add(match);
  }
}
if (problems.length > 0) {
  for (const problem of problems) {
    stderr.write(`run-node-tests: ${problem}\n`);
  }
  exit(1);
}

// node:test reports a file that defines no tests as one passing test named
// after the file itself, so only results whose name differs count as tests.
const testsPerFile = new Map([...files].map((file) => [file, 0]));
let failed = 0;

function record(data) {
  const file = typeof data.file === 'string' ? resolve(data.file) : '';
  const where = file.length > 0 ? relative(cwd(), file) : 'unknown file';
  if (data.skip !== undefined && data.skip !== false) {
    problems.push(`${where}: test "${data.name}" was skipped`);
  }
  if (data.todo !== undefined && data.todo !== false) {
    problems.push(`${where}: test "${data.name}" is marked todo`);
  }
  const count = testsPerFile.get(file);
  if (data.name !== file && count !== undefined) {
    testsPerFile.set(file, count + 1);
  }
}

const stream = run({ files: [...files] });
stream.on('test:pass', record);
stream.on('test:fail', (data) => {
  failed += 1;
  record(data);
});

const reporter = stream.compose(spec);
reporter.pipe(stdout);
reporter.on('end', () => {
  for (const [file, count] of testsPerFile) {
    if (count === 0) {
      problems.push(`${relative(cwd(), file)} ran no tests`);
    }
  }
  if (failed > 0) {
    problems.push(`${failed} test(s) failed`);
  }
  for (const problem of problems) {
    stderr.write(`run-node-tests: ${problem}\n`);
  }
  let total = 0;
  for (const count of testsPerFile.values()) {
    total += count;
  }
  stdout.write(`run-node-tests: ${total} test(s) across ${testsPerFile.size} file(s)\n`);
  exit(problems.length > 0 ? 1 : 0);
});
