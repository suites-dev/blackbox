import { execFile } from 'node:child_process';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const packedPackages = [
  '@suites/blackbox-catalog',
  '@suites/blackbox-inst-runtime-node',
  '@suites/blackbox-instrumentation',
  '@suites/blackbox-otel-collector',
  '@suites/blackbox-playwright',
  '@suites/blackbox-sandbox',
  '@suites/blackbox-telemetry',
];

function assert(value, message) {
  if (!value) throw new Error(message);
}

function isWithin(candidate, root) {
  const difference = relative(root, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

async function filesUnder(root) {
  const files = [];
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const information = await stat(path);
      if (information.isDirectory()) await visit(path);
      else if (information.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files;
}

async function sandboxRecords(resultsRoot) {
  const records = [];
  for (const path of await filesUnder(resultsRoot)) {
    if (!path.endsWith('.json')) continue;
    let value;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      continue;
    }
    if (
      value?.schemaVersion === 1 &&
      typeof value.sandboxId === 'string' &&
      typeof value.projectName === 'string' &&
      Array.isArray(value.composeFiles) &&
      typeof value.state === 'string'
    ) {
      records.push({ path, recordDirectory: dirname(path), value });
    }
  }
  return records;
}

async function dockerResources(projectName) {
  const commands = [
    ['ps', '--all', '--quiet', '--filter', `label=com.docker.compose.project=${projectName}`],
    ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${projectName}`],
    ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${projectName}`],
  ];
  const observed = [];
  for (const arguments_ of commands) {
    const { stdout } = await execute('docker', arguments_, { encoding: 'utf8' });
    observed.push(...stdout.split('\n').filter((line) => line.length > 0));
  }
  return observed;
}

export async function boundary(consumerRootValue, workspaceRootValue) {
  const consumerRoot = resolve(await realpath(consumerRootValue));
  const workspaceRoot = resolve(await realpath(workspaceRootValue));
  const packages = [];
  for (const name of packedPackages) {
    const packageRoot = resolve(
      await realpath(join(consumerRoot, 'node_modules', ...name.split('/'))),
    );
    assert(isWithin(packageRoot, consumerRoot), `${name} escaped the packed consumer`);
    assert(!isWithin(packageRoot, workspaceRoot), `${name} resolved through the workspace`);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    assert(manifest.name === name, `Packed package identity mismatch: ${name}`);
    packages.push({ name, packageRoot });
  }
  return { kind: 'playwright-packed-boundary', consumerRoot, packages };
}

export async function recover(resultsRoot, recoverSandbox) {
  const recoveries = [];
  for (const item of await sandboxRecords(resultsRoot)) {
    recoveries.push({
      sandboxId: item.value.sandboxId,
      result: await recoverSandbox({
        recordDirectory: item.recordDirectory,
        sandboxId: item.value.sandboxId,
        timeoutMs: 60_000,
      }),
    });
  }
  return { kind: 'playwright-sandbox-recovery', recoveries };
}

function collectSpecs(suite, result = []) {
  result.push(...(suite.specs ?? []));
  for (const child of suite.suites ?? []) collectSpecs(child, result);
  return result;
}

export async function verify(resultsRoot) {
  const records = await sandboxRecords(resultsRoot);
  assert(records.length === 3, `Expected three physical Sandbox records, found ${records.length}`);
  assert(
    new Set(records.map(({ value }) => value.sandboxId)).size === 3,
    'Sandbox IDs were reused',
  );
  assert(
    new Set(records.map(({ value }) => value.projectName)).size === 3,
    'Compose projects were reused',
  );
  assert(
    records.every(({ value }) => value.state === 'completed'),
    'A Sandbox did not complete',
  );
  assert(
    records.every(({ value }) => value.cleanup === 'complete'),
    'Sandbox cleanup was incomplete',
  );
  const reasons = records.map(({ value }) => value.stopReason).sort();
  assert(
    JSON.stringify(reasons) === JSON.stringify(['completed', 'completed', 'failed']),
    `Unexpected stop reasons: ${JSON.stringify(reasons)}`,
  );
  for (const { value } of records) {
    const resources = await dockerResources(value.projectName);
    assert(
      resources.length === 0,
      `Compose resources remain for ${value.projectName}: ${resources}`,
    );
  }

  const report = JSON.parse(await readFile(join(resultsRoot, 'results.json'), 'utf8'));
  const specs = report.suites.flatMap((suite) => collectSpecs(suite));
  assert(specs.length === 2, `Expected two Playwright specs, found ${specs.length}`);
  const attempts = specs.flatMap((spec) => spec.tests.flatMap((test) => test.results));
  assert(attempts.length === 3, `Expected three Playwright attempts, found ${attempts.length}`);
  const statuses = attempts.map((attempt) => attempt.status).sort();
  assert(
    JSON.stringify(statuses) === JSON.stringify(['failed', 'passed', 'passed']),
    `Unexpected Playwright attempt statuses: ${JSON.stringify(statuses)}`,
  );
  return {
    kind: 'playwright-e2e-proof',
    specs: specs.map((spec) => spec.title),
    attempts: attempts.length,
    sandboxes: records.map(({ value }) => ({
      sandboxId: value.sandboxId,
      projectName: value.projectName,
      stopReason: value.stopReason,
      cleanup: value.cleanup,
    })),
  };
}
