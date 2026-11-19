import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const e2eRoot = resolve(dirname(scriptPath), '..', '..', 'e2e');
const proofStateFile = join(
  e2eRoot,
  '.blackbox',
  'tmp',
  'proof-consumer-image-ownership.json',
);
const proofSessionFile = join(e2eRoot, '.blackbox', 'tmp', 'proof-consumer-session.json');
const proofResultFile = join(
  e2eRoot,
  '.blackbox',
  'tmp',
  'proof-consumer-image-cleanup.json',
);
const proofImage = 'sut-redis-proof-consumer:local';
const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';
const proofService = 'redis-proof-consumer';

async function dockerExecute(arguments_) {
  return await executeFile('docker', arguments_);
}

async function taggedImage(execute, tag) {
  const listed = await execute([
    'image',
    'ls',
    '--no-trunc',
    '--quiet',
    '--filter',
    `reference=${tag}`,
  ]);
  const ids = [...new Set(listed.stdout.split(/\s+/u).filter((value) => value.length > 0))];
  assert.ok(ids.length <= 1, `expected at most one image for ${tag}`);
  if (ids.length === 0) {
    return { kind: 'absent' };
  }
  const inspected = JSON.parse((await execute(['image', 'inspect', tag])).stdout);
  assert.ok(
    Array.isArray(inspected) && inspected.length === 1,
    'expected one inspected proof image',
  );
  const image = inspected[0];
  assert.equal(image.Id, ids[0], 'listed and inspected proof image identities differ');
  assert.ok(image.RepoTags.includes(tag), `image is missing exact tag ${tag}`);
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
  return { containerId: container.Id, imageId: container.Image, tag: container.Config.Image };
}

function ownedImage(image, container, projectName) {
  assert.equal(image.kind, 'present', 'proof image was not created during acquisition');
  assert.equal(
    image.id,
    container.imageId,
    'proof image does not match the exact owned session container',
  );
  const owner = image.labels['io.suites.blackbox.build-owner'];
  assert.match(owner ?? '', /^[0-9a-f-]{36}$/u, 'missing Sandbox image owner');
  assert.equal(image.labels['io.suites.blackbox.build-service'], proofService);
  assert.ok(container.tag.startsWith(`blackbox-local/${projectName}:${owner}-`), 'incorrect session build tag');
  return {
    kind: 'owned-compose-image', tag: container.tag,
    id: image.id,
    containerId: container.containerId,
    projectName,
    service: proofService,
  };
}

export async function captureImageBaseline(input) {
  const image = await taggedImage(input.execute, proofImage);
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
  const projectName =
    typeof session.composeProject === 'string'
      ? session.composeProject
      : session.composeProject?.kind === 'available'
        ? session.composeProject.value
        : undefined;
  assert.equal(
    typeof projectName,
    'string',
    'session Compose project is unavailable',
  );
  await assertBaseline(input.execute, state.baseline);
  const container = await ownedContainer({ execute: input.execute, projectName, session });
  const image = await taggedImage(input.execute, container.tag);
  const acquisition = ownedImage(image, container, projectName);
  await writeJson(input.stateFile, { ...state, acquisition });
}

async function assertBaseline(execute, baseline) {
  const current = await taggedImage(execute, proofImage);
  assert.equal(current.kind, baseline.kind, 'catalog image presence changed');
  if (baseline.kind === 'present') {
    assert.equal(current.id, baseline.id, 'catalog image identity changed');
  }
}

export async function cleanupAcquiredImage(input) {
  const state = await readJson(input.stateFile);
  await assertBaseline(input.execute, state.baseline);
  const { acquisition } = state;
  let cleanup = { kind: 'nothing-captured' };
  if (acquisition.kind === 'owned-compose-image') {
    const scoped = await taggedImage(input.execute, acquisition.tag);
    assert.equal(scoped.kind, 'absent', 'Sandbox left its build tag after down');
    cleanup = { kind: 'owned-image-already-absent', absentId: acquisition.id, tag: acquisition.tag };
  }
  const completed = { ...state, cleanup };
  await writeJson(input.stateFile, completed);
  await writeJson(input.resultFile, cleanup);
}

export async function runProofImageBaseline() {
  await captureImageBaseline({ execute: dockerExecute, stateFile: proofStateFile });
}

export async function runProofImageCapture() {
  await captureAcquiredImage({
    execute: dockerExecute,
    stateFile: proofStateFile,
    sessionFile: proofSessionFile,
  });
}

export async function runProofImageCleanup() {
  await cleanupAcquiredImage({
    execute: dockerExecute,
    stateFile: proofStateFile,
    resultFile: proofResultFile,
  });
}
