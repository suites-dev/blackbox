import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { captureCatalog } from './configuration.js';
import { catalogYaml, project, remove } from './capture.fixture.js';

const roots: string[] = [];
const capture = async (
  extra: Record<string, string> = {},
  edit?: (root: string) => Promise<void>,
) => {
  const root = await project(extra);
  roots.push(root);
  if (edit !== undefined) {
    await edit(root);
  }
  return captureCatalog({ configFile: join(root, 'blackbox.config.yaml'), entryId: 'system' });
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(remove));
});

describe('catalog capture', () => {
  it('lists configured and unconfigured participants from the catalog, not from telemetry', async () => {
    const { system } = await capture();
    expect(
      system.participants.map(({ id, instrumentation, activationId }) => [
        id,
        instrumentation,
        activationId,
      ]),
    ).toEqual([
      ['api', 'configured', 'node'],
      ['db', 'unconfigured', null],
    ]);
    expect(system.observationPolicy).toEqual({
      policyId: 'policy-1',
      requiredBoundaries: ['effects.http'],
    });
  });

  it('gives equal projects equal digests even in different directories', async () => {
    const one = await capture();
    const two = await capture();
    expect(two.catalog.digest).toBe(one.catalog.digest);
    expect(two.instrumentation.digest).toBe(one.instrumentation.digest);
    expect(JSON.stringify(one)).not.toContain('bb-envelope-');
  });

  it('changes the catalog digest when a Compose file changes, and only that', async () => {
    const base = await capture();
    const changed = await capture({
      '.blackbox/catalog/system.yml':
        'services:\n  api:\n    image: api:1\n    environment:\n      OTEL_SDK_DISABLED: "true"\n',
    });
    expect(changed.catalog.digest).not.toBe(base.catalog.digest);
    expect(changed.instrumentation.digest).toBe(base.instrumentation.digest);
  });

  it('changes the instrumentation digest when the activation or its manifest changes, and only that', async () => {
    const base = await capture();
    const activation = await capture({
      '.blackbox/instrumentation/instrumentation.js': 'module.exports = 2;\n',
    });
    const manifest = await capture({
      '.blackbox/instrumentation/package.json': '{"name":"inst","version":"1.0.1"}\n',
    });
    for (const changed of [activation, manifest]) {
      expect(changed.instrumentation.digest).not.toBe(base.instrumentation.digest);
      expect(changed.catalog.digest).toBe(base.catalog.digest);
    }
  });

  it('changes the catalog digest when the resolved entry changes', async () => {
    const base = await capture();
    const changed = await capture({
      'blackbox.config.yaml': catalogYaml
        .replace('timeoutMs: 1000\n          ', 'timeoutMs: 2000\n          ')
        .replace(
          'path: /health\n          timeoutMs: 1000',
          'path: /health\n          timeoutMs: 2000',
        ),
    });
    expect(changed.catalog.resolved).not.toBe(base.catalog.resolved);
    expect(changed.catalog.digest).not.toBe(base.catalog.digest);
  });

  it('records a missing referenced file instead of failing or ignoring it', async () => {
    const { catalog } = await capture({}, async (root) => {
      await writeFile(join(root, '.blackbox/drivers/api.mjs'), '');
      await rm(join(root, '.blackbox/drivers/api.mjs'));
    });
    expect(catalog.inputs.find(({ role }) => role === 'driver')).toMatchObject({
      state: 'missing',
      digest: null,
    });
  });

  it('refuses a referenced file outside the project instead of reading it', async () => {
    await expect(
      capture({
        'blackbox.config.yaml': catalogYaml.replace('.blackbox/drivers/api.mjs', '../outside.mjs'),
      }),
    ).rejects.toThrow(/Invalid Blackbox catalog/u);
  });
});
