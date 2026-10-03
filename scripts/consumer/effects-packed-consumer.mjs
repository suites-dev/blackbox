// Candidate tarball acceptance. Requires a current effects build; this script
// neither builds the workspace nor publishes packages or starts services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commandRecorder,
  digest,
  install,
  isolatedEnvironment,
  pack,
  packageName,
  save,
  treeHashes,
} from './effects-artifacts.mjs';
import { exerciseControls } from './effects-controls.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageDirectory = join(workspace, 'packages', 'effects');
const fixture = join(workspace, 'e2e', 'fixtures', 'effects-consumer');
const require = createRequire(import.meta.url);
const typescript = require.resolve('typescript/bin/tsc');
const scratch = await realpath(tmpdir());
assert.ok(
  scratch !== workspace && !scratch.startsWith(`${workspace}${sep}`),
  'Consumer temporary directory must be outside the workspace',
);
const artifactRoot = join(workspace, '.blackbox', 'tmp');
await mkdir(artifactRoot, { recursive: true });
const evidence = await mkdtemp(join(artifactRoot, 'effects-consumer.'));
const temporary = await mkdtemp(join(scratch, 'blackbox-effects-consumer.'));
await writeFile(join(temporary, 'empty.npmrc'), '');
const command = commandRecorder(evidence, isolatedEnvironment(temporary));
const startedAt = new Date().toISOString();
let failure;
try {
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, packageName);
  await stat(join(packageDirectory, 'dist', 'index.js'));
  await stat(join(packageDirectory, 'dist', 'index.d.ts'));
  const before = await treeHashes(packageDirectory);
  const revision = await command('revision', 'git', ['rev-parse', 'HEAD'], workspace);
  const harnessFiles = {};
  for (const name of [
    'effects-packed-consumer.mjs',
    'effects-artifacts.mjs',
    'effects-controls.mjs',
  ]) {
    harnessFiles[name] = digest(await readFile(join(workspace, 'scripts', 'consumer', name)));
  }
  await save(evidence, 'input-identity.json', {
    head: revision.stdout.trim(),
    harnessFiles,
    node: process.version,
    packageFiles: before,
    fixtures: await treeHashes(fixture),
    temporary,
    typescriptTool: typescript,
    syntheticFixture: true,
    published: false,
  });
  const candidate = await pack({
    name: 'candidate',
    directory: packageDirectory,
    temporary,
    evidence,
    command,
  });
  assert.ok(candidate.metadata.files.some((file) => file.path === 'dist/index.js'));
  assert.ok(candidate.metadata.files.some((file) => file.path === 'dist/index.d.ts'));
  const input = { ...candidate, name: 'candidate', temporary, evidence, command, fixture };
  const consumer = await install(input);
  await save(evidence, 'package-boundary.json', {
    package: packageName,
    directory: await realpath(consumer.installed),
    source: 'npm-packed tarball, offline npm installation',
    directDependencies: [packageName],
    workspaceRelativePath: relative(workspace, consumer.directory),
  });
  const candidateTest = await command(
    'candidate-test',
    process.execPath,
    ['--test', '--test-reporter=tap', 'consumer.test.mjs'],
    consumer.directory,
  );
  assert.match(candidateTest.output, /# tests 8\b/);
  assert.match(candidateTest.output, /# pass 8\b/);
  assert.match(candidateTest.output, /# skipped 0\b/);
  const declarations = await command(
    'typescript',
    process.execPath,
    [
      typescript,
      '--project',
      join(consumer.directory, 'tsconfig.json'),
      '--pretty',
      'false',
      '--listFiles',
    ],
    consumer.directory,
  );
  assert.ok(declarations.stdout.includes(join(consumer.installed, 'dist', 'index.d.ts')));
  assert.ok(!declarations.stdout.includes(join(consumer.installed, 'src')));
  assert.ok(!declarations.stdout.includes(join(workspace, 'packages')));
  const controls = await exerciseControls({ ...input, installed: consumer.installed });
  await save(evidence, 'controls.json', controls);
  const finalTest = await command(
    'candidate-test-final',
    process.execPath,
    ['--test', '--test-reporter=tap', 'consumer.test.mjs'],
    consumer.directory,
  );
  assert.match(finalTest.output, /# pass 8\b/);
  assert.deepEqual(
    await treeHashes(packageDirectory),
    before,
    'Candidate package changed during validation',
  );
  await cp(join(consumer.directory, 'tsconfig.json'), join(evidence, 'consumer-tsconfig.json'));
  await save(evidence, 'results.json', {
    candidateTests: 8,
    passed: 8,
    skipped: 0,
    declarations: 'pass',
    controls: controls.map(({ name, exit, qualification }) => ({ name, exit, qualification })),
    finalCandidate: '8/8 passed',
    qualification: 'self-review, provisional',
    scope:
      'Synthetic standalone candidate tarball acceptance; no released registry or live producer claim',
  });
} catch (error) {
  failure = error;
  await save(evidence, 'failure.json', { message: error.message, stack: error.stack });
} finally {
  await rm(temporary, { recursive: true, force: true });
  let exists = false;
  try {
    await stat(temporary);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await save(evidence, 'cleanup.json', {
    startedAt,
    endedAt: new Date().toISOString(),
    temporaryDirectory: temporary,
    removed: !exists,
    servicesStarted: false,
  });
  await save(evidence, 'artifact-hashes.json', await treeHashes(evidence));
}
process.stdout.write(`Effects consumer evidence: ${evidence}\n`);
if (failure) throw failure;
process.stdout.write(
  'Effects packed consumer passed: public runtime, declarations, isolation, semantic and packaging controls.\n',
);
