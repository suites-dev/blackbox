import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  captureAcquiredImage,
  captureImageBaseline,
  cleanupAcquiredImage,
} from './capsule-proof-image.mjs';

const tag = 'sut-redis-proof-consumer:local';
const baselineId = 'sha256:baseline';
const createdId = 'sha256:created';
const project = 'bb-proof-project';

function image(id, labels) {
  return {
    Id: id,
    RepoTags: [tag],
    Config: { Labels: labels },
  };
}

function container(imageId, composeProject = project) {
  return {
    Id: 'proof-container',
    Image: imageId,
    Config: {
      Labels: {
        'com.docker.compose.project': composeProject,
        'com.docker.compose.service': 'redis-proof-consumer',
      },
    },
  };
}

function dockerFixture(initial) {
  let current = initial;
  let containerProject = project;
  const calls = [];
  return {
    calls,
    current: () => current,
    setContainerProject: (next) => {
      containerProject = next;
    },
    set: (next) => {
      current = next;
    },
    execute: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === 'image' && arguments_[1] === 'ls') {
        return { stdout: current === null ? '' : `${current.Id}\n`, stderr: '' };
      }
      if (arguments_[0] === 'image' && arguments_[1] === 'inspect') {
        assert.notEqual(current, null);
        return { stdout: JSON.stringify([current]), stderr: '' };
      }
      if (arguments_[0] === 'container' && arguments_[1] === 'inspect') {
        assert.equal(arguments_[2], 'proof-container');
        assert.notEqual(current, null);
        return {
          stdout: JSON.stringify([container(current.Id, containerProject)]),
          stderr: '',
        };
      }
      if (arguments_[0] === 'image' && arguments_[1] === 'tag') {
        assert.equal(arguments_[2], baselineId);
        current = image(baselineId, {});
        return { stdout: '', stderr: '' };
      }
      if (arguments_[0] === 'image' && arguments_[1] === 'rm') {
        if (arguments_[2] === tag) current = null;
        return { stdout: '', stderr: '' };
      }
      assert.fail(`unexpected Docker command: ${arguments_.join(' ')}`);
    },
  };
}

async function paths(context, composeProject = { kind: 'available', value: project }) {
  const directory = await mkdtemp(join(tmpdir(), 'blackbox-proof-image-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = join(directory, 'state.json');
  const resultFile = join(directory, 'result.json');
  const sessionFile = join(directory, 'session.json');
  await writeFile(
    sessionFile,
    JSON.stringify({
      composeProject,
      containers: [
        {
          participant: 'redis-proof-consumer',
          service: 'redis-proof-consumer',
          containerId: 'proof-container',
        },
      ],
    }),
  );
  return { resultFile, sessionFile, stateFile };
}

void test('accepts the successful start response Compose project string', async (context) => {
  const files = await paths(context, project);
  const docker = dockerFixture(null);
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());

  await captureAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    sessionFile: files.sessionFile,
  });

  const state = JSON.parse(await readFile(files.stateFile, 'utf8'));
  assert.deepEqual(state.acquisition, {
    kind: 'owned-compose-image',
    id: createdId,
    containerId: 'proof-container',
    projectName: project,
    service: 'redis-proof-consumer',
  });
});

function ownedCreatedImage() {
  return image(createdId, {});
}

void test('removes the exact proof image created from an absent baseline', async (context) => {
  const files = await paths(context);
  const docker = dockerFixture(null);
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());
  await captureAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    sessionFile: files.sessionFile,
  });
  await cleanupAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    resultFile: files.resultFile,
  });
  assert.equal(docker.current(), null);
  assert.deepEqual(JSON.parse(await readFile(files.resultFile, 'utf8')), {
    kind: 'owned-image-removed',
    removedId: createdId,
  });
});

void test('accepts an owned image already absent after teardown', async (context) => {
  const files = await paths(context);
  const docker = dockerFixture(null);
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());
  await captureAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    sessionFile: files.sessionFile,
  });
  docker.set(null);

  await cleanupAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    resultFile: files.resultFile,
  });

  assert.deepEqual(JSON.parse(await readFile(files.resultFile, 'utf8')), {
    kind: 'owned-image-already-absent',
    absentId: createdId,
  });
  assert.equal(
    docker.calls.some((call) => call[0] === 'image' && call[1] === 'rm'),
    false,
  );
});

void test('restores a pre-existing image after removing the owned replacement', async (context) => {
  const files = await paths(context);
  const docker = dockerFixture(image(baselineId, {}));
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());
  await captureAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    sessionFile: files.sessionFile,
  });
  await cleanupAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    resultFile: files.resultFile,
  });
  assert.equal(docker.current().Id, baselineId);
  assert.deepEqual(JSON.parse(await readFile(files.resultFile, 'utf8')), {
    kind: 'owned-image-removed-baseline-restored',
    removedId: createdId,
    restoredId: baselineId,
  });
  assert.ok(docker.calls.some((call) => call.join(' ') === `image rm ${createdId}`));
});

void test('restores a pre-existing image when the owned replacement is already absent', async (context) => {
  const files = await paths(context);
  const docker = dockerFixture(image(baselineId, {}));
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());
  await captureAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    sessionFile: files.sessionFile,
  });
  docker.set(null);

  await cleanupAcquiredImage({
    execute: docker.execute,
    stateFile: files.stateFile,
    resultFile: files.resultFile,
  });

  assert.equal(docker.current().Id, baselineId);
  assert.deepEqual(JSON.parse(await readFile(files.resultFile, 'utf8')), {
    kind: 'owned-image-already-absent-baseline-restored',
    absentId: createdId,
    restoredId: baselineId,
  });
});

void test('refuses an image whose exact session container belongs to another project', async (context) => {
  const files = await paths(context);
  const docker = dockerFixture(null);
  await captureImageBaseline({ execute: docker.execute, stateFile: files.stateFile });
  docker.set(ownedCreatedImage());
  docker.setContainerProject('foreign-project');
  await assert.rejects(
    captureAcquiredImage({
      execute: docker.execute,
      stateFile: files.stateFile,
      sessionFile: files.sessionFile,
    }),
    /proof container Compose project is not owned/u,
  );
});
