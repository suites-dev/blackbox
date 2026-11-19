import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
// This script runs after tsc. The compiled module does not exist during source-only dependency checks.
const { nodeInstrumentationFiles } = await import(
  pathToFileURL(join(root, 'dist/runtime/bootstrap/bundle.js')).href
);
const e2e = resolve(root, '../../e2e');
const example = join(root, 'dist/examples/payment-system');
const template = join(root, 'templates/payment-system');

async function copy(source, relative) {
  const destination = join(example, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

for (const file of [
  'README.md',
  'tsconfig.json',
  'app/Dockerfile',
  'app/package.json',
  'app/npm-shrinkwrap.json',
]) {
  await copy(join(template, file), file);
}
await copy(join(template, 'playwright.config.mjs.template'), 'playwright.config.mjs');
await copy(join(template, 'clients.d.ts.template'), 'clients/types.d.ts');
await copy(join(template, 'compose.yaml'), '.blackbox/catalog/payment-system.yml');
await copy(join(e2e, 'blackbox-payment.yaml'), 'blackbox.config.yaml');
for (const file of ['init.sql', 'server.cjs']) {
  await copy(join(e2e, 'sut/payment-acceptance', file), 'app/' + file);
}
for (const file of ['postgres.ts', 'redis.ts']) {
  await copy(join(e2e, '.blackbox/clients', file), 'clients/' + file);
}
for (const file of ['payment-intents.spec.ts', 'snapshots/payment-state.txt']) {
  await copy(join(e2e, 'tests/playwright-payment', file), 'tests/' + file);
}
const bundle = join(example, '.blackbox/instrumentation');
await mkdir(bundle, { recursive: true });
for (const { name, content } of nodeInstrumentationFiles) {
  await writeFile(join(bundle, name), content);
}
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const { devDependencies: sutTools } = JSON.parse(
  await readFile(join(e2e, 'sut/package.json'), 'utf8'),
);
const { dependencies, devDependencies } = JSON.parse(
  await readFile(join(e2e, 'package.json'), 'utf8'),
);
const manifest = {
  name: 'blackbox-payment-example',
  version: '1.0.0',
  private: true,
  type: 'module',
  devDependencies: {
    '@suites/blackbox': version,
    '@suites/blackbox-cli': version,
    '@suites/blackbox-inst-runtime-node': version,
    '@suites/blackbox-playwright': version,
    '@playwright/test': dependencies['@playwright/test'],
    '@types/pg': devDependencies['@types/pg'],
    typescript: sutTools.typescript,
    pg: dependencies.pg,
    redis: dependencies.redis,
  },
};
await writeFile(join(example, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
