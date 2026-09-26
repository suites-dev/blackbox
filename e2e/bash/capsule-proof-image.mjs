import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const e2eRoot = resolve(dirname(scriptPath), '..');
const proofImage = 'sut-redis-proof-consumer:local';
const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';
const proofService = 'redis-proof-consumer';

async function dockerExecute(arguments_) {
  return await executeFile('docker', arguments_);
}

async function taggedImage(execute) {
  const listed = await execute([
    'image',
    'ls',
    '--no-trunc',
    '--quiet',
    '--filter',
    `reference=${proofImage}`,
  ]);
  const ids = [...new Set(listed.stdout.split(/\s+/u).filter((value) => value.length > 0))];
  assert.ok(ids.length <= 1, `expected at most one image for ${proofImage}`);
  if (ids.length === 0) {
    return { kind: 'absent' };
  }
  const inspected = JSON.parse((await execute(['image', 'inspect', proofImage])).stdout);
  assert.ok(
    Array.isArray(inspected) && inspected.length === 1,
    'expected one inspected proof image',
  );
  const image = inspected[0];
  assert.equal(image.Id, ids[0], 'listed and inspected proof image identities differ');
  assert.ok(image.RepoTags.includes(proofImage), `image is missing exact tag ${proofImage}`);
  return {
    kind: 'present',
    id: image.Id,
    repoTags: image.RepoTags,
    labels: image.Config.Labels ?? {},
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function ownedContainer(input) {
  const matches = input.session.containers.filter(
    (container) => container.service === proofService,
  );
  assert.equal(matches.length, 1, `expected one ${proofService} session container`);
  const sessionContainer = matches[0];
  const inspected = JSON.parse(
    (await input.execute(['container', 'inspect', sessionContainer.containerId])).stdout,
  );
  assert.ok(
    Array.isArray(inspected) && inspected.length === 1,
    'expected one inspected proof container',
  );
  const container = inspected[0];
  assert.equal(container.Id, sessionContainer.containerId, 'proof container identity changed');
  assert.equal(
    container.Config?.Labels?.[projectLabel],
    input.projectName,
    'proof container Compose project is not owned',
  );
  assert.equal(
    container.Config?.Labels?.[serviceLabel],
    proofService,
    'proof container Compose service is not owned',
  );
  return { containerId: container.Id, imageId: container.Image };
}

function ownedImage(image, container, projectName) {
  assert.equal(image.kind, 'present', 'proof image was not created during acquisition');
  assert.equal(
    image.id,
    container.imageId,
    'proof image does not match the exact owned session container',
  );
  return {
    kind: 'owned-compose-image',
    id: image.id,
    containerId: container.containerId,
    projectName,
    service: proofService,
  };
}

export async function captureImageBaseline(input) {
  const image = await taggedImage(input.execute);
  const baseline = image.kind === 'absent' ? { kind: 'absent' } : { kind: 'present', id: image.id };
  await writeJson(input.stateFile, {
    kind: 'proof-consumer-image-ownership',
    image: proofImage,
    baseline,
    acquisition: { kind: 'not-captured' },
    cleanup: { kind: 'not-attempted' },
  });
}

export async function captureAcquiredImage(input) {
  const state = await readJson(input.stateFile);
  const session = await readJson(input.sessionFile);
  assert.equal(session.composeProject.kind, 'available', 'session Compose project is unavailable');
  const projectName = session.composeProject.value;
  const image = await taggedImage(input.execute);
  const container = await ownedContainer({
    execute: input.execute,
    projectName,
    session,
  });
  assert.equal(
    image.kind === 'present' ? image.id : undefined,
    container.imageId,
    'tagged proof image does not match the exact owned session container',
  );
  const acquisition =
    state.baseline.kind === 'present' && image.kind === 'present' && image.id === state.baseline.id
      ? { kind: 'baseline-image-reused', id: image.id }
      : ownedImage(image, container, projectName);
  await writeJson(input.stateFile, { ...state, acquisition });
}

async function cleanupOwnedImage(input, state, image) {
  const owned = state.acquisition;
  assert.equal(image.kind, 'present', 'owned proof image disappeared before cleanup');
  assert.equal(image.id, owned.id, 'proof image tag changed ownership before cleanup');
  if (state.baseline.kind === 'present') {
    await input.execute(['image', 'tag', state.baseline.id, proofImage]);
    const otherTags = image.repoTags.filter((tag) => tag !== proofImage);
    if (otherTags.length === 0) {
      await input.execute(['image', 'rm', owned.id]);
    }
    const restored = await taggedImage(input.execute);
    assert.equal(restored.kind, 'present', 'pre-existing proof image tag was not restored');
    assert.equal(restored.id, state.baseline.id, 'proof image baseline identity was not restored');
    return {
      kind: 'owned-image-removed-baseline-restored',
      removedId: owned.id,
      restoredId: state.baseline.id,
    };
  }
  await input.execute(['image', 'rm', proofImage]);
  assert.equal(
    (await taggedImage(input.execute)).kind,
    'absent',
    'owned proof image tag remains after cleanup',
  );
  return { kind: 'owned-image-removed', removedId: owned.id };
}

export async function cleanupAcquiredImage(input) {
  const state = await readJson(input.stateFile);
  let cleanup;
  if (state.acquisition.kind === 'not-captured') {
    cleanup = { kind: 'nothing-captured' };
  } else if (state.acquisition.kind === 'baseline-image-reused') {
    const current = await taggedImage(input.execute);
    assert.equal(current.kind, 'present', 'pre-existing proof image disappeared');
    assert.equal(current.id, state.acquisition.id, 'pre-existing proof image tag changed');
    cleanup = { kind: 'preexisting-image-preserved', id: state.acquisition.id };
  } else {
    cleanup = await cleanupOwnedImage(input, state, await taggedImage(input.execute));
  }
  const completed = { ...state, cleanup };
  await writeJson(input.stateFile, completed);
  await writeJson(input.resultFile, cleanup);
}

async function main() {
  const [operation, artifactName, sessionId, ...unexpected] = process.argv.slice(2);
  if (
    artifactName === undefined ||
    !/^capsule-test\.[A-Za-z0-9]+$/u.test(artifactName) ||
    unexpected.length > 0
  ) {
    throw new Error(
      'Usage: capsule-proof-image.mjs <baseline run|capture run session|cleanup run>',
    );
  }
  const artifactRoot = join(e2eRoot, '.blackbox', 'tmp', artifactName);
  const stateFile = join(artifactRoot, 'proof-consumer-image-ownership.json');
  if (operation === 'baseline' && sessionId === undefined) {
    await captureImageBaseline({ execute: dockerExecute, stateFile });
    return;
  }
  if (
    operation === 'capture' &&
    sessionId !== undefined &&
    /^[a-z]+-[a-z]+-[a-z]+$/u.test(sessionId)
  ) {
    await captureAcquiredImage({
      execute: dockerExecute,
      stateFile,
      sessionFile: join(
        e2eRoot,
        '.blackbox',
        'experiments',
        `capsule-${sessionId}`,
        'session.json',
      ),
    });
    return;
  }
  if (operation === 'cleanup' && sessionId === undefined) {
    await cleanupAcquiredImage({
      execute: dockerExecute,
      stateFile,
      resultFile: join(artifactRoot, 'proof-consumer-image-cleanup.json'),
    });
    return;
  }
  throw new Error(
    'Usage: capsule-proof-image.mjs <baseline run|capture run session|cleanup run>',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  await main();
}
