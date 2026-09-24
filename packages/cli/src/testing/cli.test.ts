import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { runCli } from '../capsule/reporting/capsule-command.fixture.js';

async function catalogProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'bb-cli-catalog-'));
  await mkdir(join(directory, '.blackbox/compose'), { recursive: true });
  await writeFile(join(directory, '.blackbox/compose/orders.yml'), 'services: {}\n');
  await writeFile(
    join(directory, 'blackbox.config.yaml'),
    `schemaVersion: 1
catalog:
  default: orders
  entries:
    orders:
      kind: system
      acquisition: { adapter: docker-compose@1, files: [.blackbox/compose/orders.yml] }
      isolation: per-test
      entrypoint:
        participant: api
        protocol: http
        containerPort: 3000
        readiness: { path: /health, timeoutMs: 1000 }
      participants:
        api: { service: api, role: entrypoint, runtime: infra }
      observation:
        policyId: orders-v1
        boundaries: []
        requiredBoundaries: []
        terminalObservationWindowMs: 0
        redaction: { requestBodies: not-captured, headers: [], dynamicIdentifiers: none }
activations: {}
clients: {}
`,
  );
  return directory;
}

void test('oclif discovers the facade and help names the phases', async () => {
  const result = await runCli({ directory: process.cwd(), argv: ['--help'] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sandboxes, Testing, and Assurance/u);
  assert.match(result.stdout, /capsule/u);
  assert.match(result.stdout, /catalog/u);
});

void test('catalog list delegates to the catalog package and emits deterministic JSON', async () => {
  const directory = await catalogProject();
  try {
    const result = await runCli({ directory, argv: ['catalog', 'list', '--json'] });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      default: 'orders',
      entries: [{ id: 'orders', kind: 'system', isDefault: true }],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test('catalog validation reports a missing project file as a nonzero CLI error', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-missing-catalog-'));
  try {
    const result = await runCli({ directory, argv: ['catalog', 'validate'] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /blackbox\.config\.yaml/u);
    assert.equal(result.stdout, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
