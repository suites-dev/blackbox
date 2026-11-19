import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  createNodeRuntimeActivation,
  nodeInstrumentationFiles,
} from '@suites/blackbox-inst-runtime-node';

const run = promisify(execFile);
const consumer = await realpath(import.meta.dirname);
const config = await realpath(
  fileURLToPath(import.meta.resolve('@suites/blackbox-inst-runtime-node/examples/payment-system')),
);
assert.ok(
  relative(consumer, config).startsWith('node_modules/'),
  'sample escaped the installed consumer',
);
const example = await mkdtemp(join(consumer, 'payment-example-'));
const environment = { ...process.env, NPM_CONFIG_OFFLINE: 'true' };
const options = { cwd: example, env: environment, timeout: 90_000 };
const cli = join(consumer, 'node_modules/.bin/blackbox');
const playwright = join(consumer, 'node_modules/.bin/playwright');
const source = dirname(config);
try {
  await cp(source, example, { recursive: true });
  // Consume exactly the project-local dependencies prepared by the registry lane.
  await cp(
    join(consumer, '.blackbox/instrumentation/node_modules'),
    join(example, '.blackbox/instrumentation/node_modules'),
    { recursive: true },
  );
  await cp(
    join(consumer, '.blackbox/clients/node_modules'),
    join(example, 'clients/node_modules'),
    { recursive: true },
  );
  const { stdout: installation } = await run(
    cli,
    ['inst', 'install', '--runtime', 'node'],
    options,
  );
  assert.match(installation, /Node instrumentation already current/u);
  for (const { name, content } of nodeInstrumentationFiles) {
    assert.equal(await readFile(join(example, '.blackbox/instrumentation', name), 'utf8'), content);
  }
  const validate = () => run(cli, ['catalog', 'validate', '--json'], options);
  const { stdout: validated } = await validate();
  const result = JSON.parse(validated);
  assert.equal(result.ok, true);
  assert.equal(result.defaultEntry, 'payment-system');
  assert.equal(result.entryCount, 1);

  const project = createRequire(join(example, 'package.json'));
  const core = createRequire(project.resolve('@suites/blackbox'));
  const yaml = createRequire(core.resolve('@suites/blackbox-catalog'))('yaml');
  const catalogPath = join(example, 'blackbox.config.yaml');
  const original = await readFile(catalogPath, 'utf8');
  const catalog = yaml.parse(original);
  const entry = catalog.catalog.entries['payment-system'];
  const participant = entry.participants[entry.entrypoint.participant];
  const activation = catalog.activations[participant.activation];
  assert.deepEqual(activation, {
    ref: '.blackbox/instrumentation/instrumentation.js',
    adapter: 'node-preload',
    version: 1,
  });
  const composeFile = join(example, entry.acquisition.files[0]);
  const compose = yaml.parse(await readFile(composeFile, 'utf8'));
  const api = compose.services[participant.service];
  const app = join(dirname(composeFile), api.build);
  const shrinkwrap = JSON.parse(await readFile(join(app, 'npm-shrinkwrap.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  assert.deepEqual(shrinkwrap.packages[''].dependencies, manifest.dependencies);
  assert.match(await readFile(join(app, 'Dockerfile'), 'utf8'), /CMD \["node", "server\.cjs"\]/u);
  await run(process.execPath, ['--check', join(app, 'server.cjs')], options);
  const [sql] = compose.services.postgres.volumes[0].split(':');
  assert.match(
    await readFile(join(dirname(composeFile), sql), 'utf8'),
    /CREATE TABLE payment_intent/u,
  );
  assert.equal(api.environment.NODE_OPTIONS, '--enable-source-maps');
  for (const adapter of ['node-preload', 'node-esm']) {
    const bootstrapPath = join(example, activation.ref);
    const dependencyDirectory = join(dirname(bootstrapPath), 'node_modules');
    const node = createNodeRuntimeActivation({
      kind: 'node-runtime-activation',
      adapter,
      bootstrapPath,
      dependencyDirectory,
      inheritedNodeOptions: { kind: 'present', value: api.environment.NODE_OPTIONS },
    });
    const expected = ['--enable-source-maps'];
    if (adapter === 'node-esm')
      expected.push(
        '--experimental-loader=' +
          join(dependencyDirectory, '@opentelemetry/instrumentation/hook.mjs'),
      );
    expected.push('--require=' + bootstrapPath);
    assert.deepEqual(node.environment.NODE_OPTIONS.split(' '), expected);
    const probe = await run(process.execPath, ['-e', 'console.log(process.sourceMapsEnabled)'], {
      ...options,
      env: { ...environment, ...node.environment },
    });
    assert.equal(probe.stdout.trim(), 'true');
  }

  const { stdout: discovery } = await run(
    playwright,
    ['test', '--list'],
    options,
  );
  assert.match(discovery, /Scenario: Alice submits a valid payment method/u);
  assert.match(discovery, /Total: 1 test in 1 file/u);
  const snapshot = JSON.parse(
    await readFile(join(example, 'tests/snapshots/payment-state.txt'), 'utf8'),
  );
  assert.deepEqual(snapshot, [{ id: '<created-intent>', status: 'succeeded' }]);

  activation.ref = '.blackbox/instrumentation';
  await writeFile(catalogPath, yaml.stringify(catalog));
  await assert.rejects(validate(), { code: 1 });
  const { runCatalogValidate } = await import(
    pathToFileURL(core.resolve('@suites/blackbox-catalog'))
  );
  const failure = await runCatalogValidate({ projectDirectory: example });
  assert.equal(failure.classification, 'referenced-input-invalid');
  assert.ok(
    failure.diagnostics.some(
      (item) =>
        item.instancePath === '/activations/payment-node/ref' &&
        /must refer to a file/u.test(item.message),
    ),
  );
  console.log(
    'Packaged payment example: Node installer, catalog, Compose assets, preload/ESM flags, native discovery, reviewed snapshot and directory-ref rejection passed.',
  );
} finally {
  await rm(example, { recursive: true, force: true });
}
