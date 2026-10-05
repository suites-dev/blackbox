import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  verifyAttemptReports,
  verifyEffectReports,
  verifyParallelAcquisition,
} from './playwright-report-proof.mjs';

const execute = promisify(execFile);
const supportDirectory = dirname(fileURLToPath(import.meta.url));
const resultsRoot = resolve(supportDirectory, 'test-results');
const expectedSpecs = [
  'Scenario: a local-only user activates without payment or ordering',
  'Scenario: a repeated request does not repeat downstream effects',
  'Scenario: a second refund for the same payment is rejected',
  'Scenario: a valid payment method creates a payment intent',
  'Scenario: an eligible user receives an active subscription',
  'Scenario: an unknown payment intent cannot be refunded',
  'Scenario: an unknown user is rejected without side effects',
  'Scenario: concurrent requests create exactly one subscription',
  'PostgreSQL activity is observed while its operation remains unknown',
  'RabbitMQ activity is observed while send remains unknown',
  'forbidden database activity produces a definite matcher failure',
  'inspection database activity cannot satisfy a stimulus database contract',
  '@isolation alpha attempt cannot use the other destination',
  '@isolation beta attempt cannot use the other destination',
  'database activity remains observable after rollback while state is absent',
  'browser stimulus propagates ownership to PostgreSQL activity',
  'plain browser work cannot satisfy a later stimulus contract',
  '@withheld successful action stays inconclusive under positive and negated matchers',
].sort();

function assert(value, message) {
  if (!value) throw new Error(message);
}

function isWithin(candidate, root) {
  const difference = relative(root, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

async function filesUnder() {
  const files = [];
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      assert(isWithin(path, resultsRoot), `Evidence path escaped the results root: ${path}`);
      const information = await lstat(path);
      if (information.isDirectory()) await visit(path);
      else if (information.isFile()) files.push(path);
      else throw new Error(`Unsupported evidence entry: ${path}`);
    }
  }
  await visit(resultsRoot);
  return files;
}

async function sandboxRecords() {
  const records = [];
  for (const path of await filesUnder()) {
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
      records.push({ path, recordDirectory: await realpath(dirname(path)), value });
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

export async function boundary(consumerRootValue) {
  const consumerRoot = resolve(await realpath(consumerRootValue));
  const consumerManifest = JSON.parse(await readFile(join(consumerRoot, 'package.json'), 'utf8'));
  const consumerLock = JSON.parse(await readFile(join(consumerRoot, 'package-lock.json'), 'utf8'));
  const registryPackages = Object.keys(consumerManifest.dependencies ?? {})
    .filter((name) => name.startsWith('@suites/blackbox-'))
    .sort();
  assert(
    registryPackages.includes('@suites/blackbox-playwright'),
    'Registry consumer did not declare @suites/blackbox-playwright',
  );
  const packages = [];
  for (const name of registryPackages) {
    const packageRoot = resolve(
      await realpath(join(consumerRoot, 'node_modules', ...name.split('/'))),
    );
    assert(isWithin(packageRoot, consumerRoot), `${name} escaped the registry consumer`);
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    assert(manifest.name === name, `Registry package identity mismatch: ${name}`);
    assert(typeof manifest.version === 'string', `Registry package version is missing: ${name}`);
    const resolution = consumerLock.packages?.[`node_modules/${name}`];
    assert(
      typeof resolution?.integrity === 'string' && typeof resolution?.resolved === 'string',
      `Registry package lock provenance is missing: ${name}`,
    );
    packages.push({
      name,
      version: manifest.version,
      packageRoot,
      resolved: resolution.resolved,
      integrity: resolution.integrity,
    });
  }
  const projectFiles = [
    'blackbox.config.yaml',
    '.blackbox/catalog/effects-acceptance.yml',
    '.blackbox/catalog/subscription-system.yml',
    '.blackbox/instrumentation/instrumentation.js',
    '.blackbox/instrumentation/package.json',
    'playwright.config.ts',
    'reporters/blackbox-evidence.ts',
    'reporters/native-lifecycle.ts',
    'sut/effects-acceptance/Dockerfile',
    'sut/effects-acceptance/app.cjs',
    'sut/effects-acceptance/init.sql',
    'sut/effects-acceptance/package-lock.json',
    'sut/effects-acceptance/package.json',
    'tests/playwright/effects-acceptance.spec.ts',
    'tests/playwright/effects-acceptance.support.ts',
  ];
  for (const name of projectFiles) {
    const path = resolve(await realpath(join(consumerRoot, name)));
    assert(isWithin(path, consumerRoot), `Project file escaped the registry consumer: ${name}`);
  }
  const projectFileHashes = Object.fromEntries(
    await Promise.all(
      projectFiles.map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(join(consumerRoot, name)))
          .digest('hex'),
      ]),
    ),
  );
  const instrumentationDependencies = resolve(
    await realpath(join(consumerRoot, '.blackbox', 'instrumentation', 'node_modules')),
  );
  assert(
    isWithin(instrumentationDependencies, consumerRoot),
    'Instrumentation dependencies escaped the registry consumer',
  );
  return {
    kind: 'playwright-registry-consumer-boundary',
    consumerRoot,
    packages,
    projectFiles,
    projectFileHashes,
    instrumentationDependencies,
  };
}

export async function recover(recoverSandbox) {
  const recoveries = [];
  for (const item of await sandboxRecords()) {
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

export function expectedCatalogForSpec(file, title) {
  const name = file.split(/[/\\]/u).at(-1);
  if (name === 'effects-acceptance.spec.ts') {
    return {
      kind: 'system',
      id: title.startsWith('@withheld ') ? 'effects-withheld' : 'effects-acceptance',
    };
  }
  return {
    'payment-service.spec.ts': { kind: 'subsystem', id: 'payment-mock' },
    'subscription-system.spec.ts': { kind: 'system', id: 'subscription-system' },
  }[name];
}

export async function verify() {
  const records = await sandboxRecords();
  assert(
    records.length === expectedSpecs.length,
    `Expected ${expectedSpecs.length} physical Sandbox records, found ${records.length}`,
  );
  assert(
    new Set(records.map(({ value }) => value.sandboxId)).size === expectedSpecs.length,
    'Sandbox IDs were reused',
  );
  assert(
    new Set(records.map(({ value }) => value.projectName)).size === expectedSpecs.length,
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
  assert(
    records.every(({ value }) => value.stopReason === 'completed'),
    `Unexpected stop reasons: ${JSON.stringify(records.map(({ value }) => value.stopReason))}`,
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
  assert(
    specs.length === expectedSpecs.length,
    `Expected ${expectedSpecs.length} Playwright specs, found ${specs.length}`,
  );
  const discoveredSpecs = specs.map((spec) => spec.title).sort();
  assert(
    JSON.stringify(discoveredSpecs) === JSON.stringify(expectedSpecs),
    `Unexpected Playwright specs: ${JSON.stringify(discoveredSpecs)}`,
  );
  const attempts = specs.flatMap((spec) => {
    const expectedCatalog = expectedCatalogForSpec(spec.file, spec.title);
    assert(expectedCatalog !== undefined, `Unexpected scenario file: ${spec.file}`);
    return spec.tests.flatMap((test) =>
      test.results.map((result) => ({
        ...result,
        title: spec.title,
        testId: spec.id,
        expectedCatalog,
      })),
    );
  });
  assert(
    attempts.length === expectedSpecs.length,
    `Expected ${expectedSpecs.length} Playwright attempts, found ${attempts.length}`,
  );
  assert(
    attempts.every((attempt) => attempt.status === 'passed'),
    `Unexpected Playwright attempt statuses: ${JSON.stringify(
      attempts.map((attempt) => attempt.status),
    )}`,
  );
  const live = JSON.parse(await readFile(join(resultsRoot, 'live-reporting.json'), 'utf8'));
  verifyParallelAcquisition(live);
  const effects = verifyEffectReports(attempts);
  return {
    kind: 'playwright-e2e-proof',
    effects,
    reporting: verifyAttemptReports({
      attempts,
      records,
      live,
      text: await readFile(join(resultsRoot, 'execution.txt'), 'utf8'),
    }),
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
