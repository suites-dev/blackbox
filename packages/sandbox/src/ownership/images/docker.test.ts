import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { recoverBuildImages, removeRecordedImages, requireUnusedTags } from './docker.js';
import { ownerLabel, planInventory, readInventory, serviceLabel, writeInventory } from './inventory.js';

const id = `sha256:${'a'.repeat(64)}`;
const project = 'bb-owned-test';
const intent = planInventory(project, ['api']);
const [entry] = intent.images;
const image = { Id: id, RepoTags: [entry.tag], Config: { Labels: {
  [ownerLabel]: intent.owner, [serviceLabel]: 'api',
} } };
const recorded = { ...intent, images: [{ ...entry, imageId: id }] };

function client(initial: typeof image, retain = false) {
  let present = true;
  const inspect = vi.fn(() => present ? Promise.resolve(initial) : Promise.reject(Object.assign(new Error('missing'), { statusCode: 404 })));
  const remove = vi.fn((_options: { force: false; noprune: true }) => {
    present = retain;
    return Promise.resolve();
  });
  const getImage = vi.fn((tag: string) => {
    expect(tag).toBe(entry.tag);
    return { inspect, remove };
  });
  return { getImage, remove };
}

it.each([
  ['owner label', { ...image, Config: { Labels: { ...image.Config.Labels, [ownerLabel]: 'foreign' } } }],
  ['service label', { ...image, Config: { Labels: { ...image.Config.Labels, [serviceLabel]: 'other' } } }],
  ['reference', { ...image, RepoTags: ['user/catalog:local'] }],
  ['image ID', { ...image, Id: `sha256:${'b'.repeat(64)}` }],
] as const)('preserves the tag if its %s changed', async (_name, foreign) => {
  const docker = client({ ...foreign, RepoTags: [...foreign.RepoTags] });
  await expect(removeRecordedImages(docker, recorded)).rejects.toThrow('changed or foreign');
  expect(docker.remove).not.toHaveBeenCalled();
});

it('refuses an occupied target before build and verifies each deletion', async () => {
  const docker = client(image, true);
  await expect(requireUnusedTags(docker, intent)).rejects.toThrow('existing Sandbox build tag');
  expect(docker.remove).not.toHaveBeenCalled();
  await expect(removeRecordedImages(docker, recorded)).rejects.toThrow('remains after cleanup');
  expect(docker.remove).toHaveBeenCalledExactlyOnceWith({ force: false, noprune: true });
});

it('recovers a partial build from the admitted intent, retries absence, and rejects altered records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bb-build-images-'));
  const docker = client(image);
  try {
    await expect(readInventory(directory, project)).resolves.toBeNull();
    await writeInventory(directory, intent, 'create');
    await expect(writeInventory(directory, planInventory(project, ['api']), 'create')).rejects.toMatchObject({ code: 'EEXIST' });
    await recoverBuildImages(docker, directory, project);
    await recoverBuildImages(docker, directory, project);
    expect(docker.remove).toHaveBeenCalledExactlyOnceWith({ force: false, noprune: true });
    await expect(recoverBuildImages(docker, directory, 'other')).rejects.toThrow('ownership record');
    await writeFile(join(directory, 'build-images.json'), JSON.stringify({
      ...intent, images: [{ ...entry, tag: 'user/catalog:local' }],
    }));
    await expect(recoverBuildImages(docker, directory, project)).rejects.toThrow('build image identity');
    expect(docker.remove).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
