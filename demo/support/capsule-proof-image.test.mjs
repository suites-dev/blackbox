import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureAcquiredImage, captureImageBaseline, cleanupAcquiredImage } from './capsule-proof-image.mjs';

const catalog = 'sut-redis-proof-consumer:local';
const project = 'bb-proof-project';
const service = 'redis-proof-consumer';
const owner = '79898eb8-bea5-4720-8454-64e711daabcc';
const tag = `blackbox-local/${project}:${owner}-4f003955ab939ab8ed5de725`;
const buildId = 'sha256:created';

function image(ref, id, labels = {}) {
  return { Id: id, RepoTags: [ref], Config: { Labels: labels } };
}

async function fixture(t, baseline, composeProject = { kind: 'available', value: project }) {
  const dir = await mkdtemp(join(tmpdir(), 'blackbox-proof-image-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  const resultFile = join(dir, 'result.json');
  const sessionFile = join(dir, 'session.json');
  await writeFile(sessionFile, JSON.stringify({ composeProject, containers: [{ service, containerId: 'container' }] }));
  const images = new Map();
  if (baseline !== null) images.set(catalog, image(catalog, baseline));
  const container = { Id: 'container', Image: buildId, Config: { Image: tag, Labels: {
    'com.docker.compose.project': project, 'com.docker.compose.service': service,
  } } };
  async function execute(args) {
    const [kind, command] = args;
    if (kind === 'container' && command === 'inspect' && args[2] === 'container') {
      return { stdout: JSON.stringify([container]) };
    }
    if (kind === 'image' && command === 'ls') {
      const value = images.get(args.at(-1).replace(/^reference=/u, ''));
      return { stdout: value?.Id ?? '' };
    }
    if (kind === 'image' && command === 'inspect') {
      assert.ok(images.has(args[2]));
      return { stdout: JSON.stringify([images.get(args[2])]) };
    }
    assert.fail(`unexpected command ${args.join(' ')}`);
  }
  const input = { execute, stateFile, resultFile, sessionFile };
  await captureImageBaseline(input);
  images.set(tag, image(tag, buildId, { 'io.suites.blackbox.build-owner': owner, 'io.suites.blackbox.build-service': service }));
  return { input, images, container };
}

for (const baseline of [null, 'sha256:preexisting']) {
  test(`observes a scoped build and teardown with catalog baseline ${baseline}`, async (t) => {
    const { input, images } = await fixture(t, baseline, baseline === null ? project : undefined);
    await captureAcquiredImage(input);
    images.delete(tag);
    await cleanupAcquiredImage(input);
    assert.deepEqual(JSON.parse(await readFile(input.resultFile, 'utf8')), {
      kind: 'owned-image-already-absent', absentId: buildId, tag,
    });
    assert.equal(images.get(catalog)?.Id ?? null, baseline);
  });
}

test('rejects catalog tag drift during acquisition or after teardown', async (t) => {
  const { input, images } = await fixture(t, 'sha256:preexisting');
  images.set(catalog, image(catalog, buildId));
  await assert.rejects(captureAcquiredImage(input), /catalog image identity changed/u);
  await assert.rejects(cleanupAcquiredImage(input), /catalog image identity changed/u);
});

test('rejects a session tag left after teardown', async (t) => {
  const { input } = await fixture(t, null);
  await captureAcquiredImage(input);
  await assert.rejects(cleanupAcquiredImage(input), /left its build tag/u);
});

test('rejects a foreign container, mismatched image ID, or missing build owner', async (t) => {
  const { input, images, container } = await fixture(t, null);
  container.Config.Labels['com.docker.compose.project'] = 'foreign';
  await assert.rejects(captureAcquiredImage(input), /Compose project is not owned/u);
  container.Config.Labels['com.docker.compose.project'] = project;
  container.Image = 'sha256:foreign';
  await assert.rejects(captureAcquiredImage(input), /exact owned session container/u);
  container.Image = buildId;
  images.set(tag, image(tag, buildId));
  await assert.rejects(captureAcquiredImage(input), /missing Sandbox image owner/u);
});
