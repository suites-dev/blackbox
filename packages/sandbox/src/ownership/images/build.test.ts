import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IDockerComposeOptions } from 'docker-compose';
import { expect, it, vi } from 'vitest';

import type { ComposeStartRequest } from '../../model/compose.js';
import { buildSandboxImages } from './build.js';
import type { BuildImageDocker } from './docker.js';
import { ownerLabel, readInventory, serviceLabel } from './inventory.js';

const compose = vi.hoisted(() => ({
  config: vi.fn<(options: IDockerComposeOptions) => Promise<unknown>>(),
  buildMany: vi.fn<(services: string[], options: IDockerComposeOptions) => Promise<unknown>>(),
  buildAll: vi.fn(),
}));
vi.mock('docker-compose', () => ({ default: compose }));

function request(directory: string): ComposeStartRequest {
  return {
    observation: { kind: 'silent' }, projectDirectory: directory, composeFiles: ['base.yml', 'amend.yml'],
    projectName: 'bb-test', generatedComposeDirectory: join(directory, 'generated'),
    environment: { MARK: 'marker' }, serviceSelection: { kind: 'selected', services: ['app'] },
    startupTimeoutMs: 100, endpoints: [], telemetry: { kind: 'disabled' },
  };
}

it('applies one recorded build override to resolved build services only and cleans partial build failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bb-build-planning-'));
  const input = request(root);
  const output = new Map<string, { Id: string; RepoTags: string[]; Config: { Labels: Record<string, string> } }>();
  const docker = {
    getImage: (tag) => ({
      inspect: () => {
        const found = output.get(tag);
        if (found === undefined) {
          return Promise.reject(Object.assign(new Error('missing'), { statusCode: 404 }));
        }
        return Promise.resolve(found);
      },
      remove: () => Promise.resolve(output.delete(tag)),
    }),
  } satisfies BuildImageDocker;
  compose.config.mockResolvedValue({ data: { config: { services: {
    db: { image: 'postgres:16' }, app: { build: { context: './app', tags: ['shared:extra'] } },
    hidden: { profiles: ['optional'], build: { context: './optional' } },
  } } } });
  compose.buildMany.mockImplementationOnce(async (services: string[], options: IDockerComposeOptions) => {
    expect(services).toEqual(['app']);
    const inventory = await readInventory(input.generatedComposeDirectory, input.projectName);
    if (inventory === null) {
      throw new Error('build began before its inventory was published');
    }
    expect(inventory.images.map(({ service }) => service)).toEqual(['app', 'hidden']);
    expect(options.config).toEqual([...input.composeFiles, join(input.generatedComposeDirectory, 'build-images.compose.yaml')]);
    const override = await readFile(join(input.generatedComposeDirectory, 'build-images.compose.yaml'), 'utf8');
    expect(override).toContain('tags: !reset []');
    expect(override).not.toContain('postgres:16');
    for (const entry of inventory.images) {
      expect(override).toContain(entry.tag);
    }
    const { tag, service } = inventory.images[0];
    output.set(tag, { Id: `sha256:${'a'.repeat(64)}`, RepoTags: [tag], Config: { Labels: {
      [ownerLabel]: inventory.owner, [serviceLabel]: service,
    } } });
    throw new Error('second build failed');
  });
  try {
    await expect(buildSandboxImages(input, docker)).rejects.toThrow('second build failed');
    expect(output.size).toBe(0);
    expect(compose.config.mock.calls.map(([options]) => [options.composeOptions, options.config])).toEqual([
      [['--project-name', input.projectName, '--profile', '*'], input.composeFiles],
    ]);
    expect(compose.buildMany.mock.calls.map(([services, options]) => [services, options.commandOptions])).toEqual([
      [['app'], ['--with-dependencies']],
    ]);
    expect(compose.buildAll).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
