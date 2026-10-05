import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const declaredMutableInputs = Object.freeze([
  'localstack/localstack:3.8',
  'node:22.22.0-bookworm-slim',
  'postgres:16-alpine',
  'redis:7-alpine',
]);

function resolvedImage(declared, inspection) {
  if (typeof inspection?.Id !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(inspection.Id)) {
    throw new Error(`Docker did not resolve an immutable image ID for ${declared}`);
  }
  return {
    declared,
    state: 'resolved',
    imageId: inspection.Id,
    repoDigests: [...(inspection.RepoDigests ?? [])].sort(),
    repoTags: [...(inspection.RepoTags ?? [])].sort(),
  };
}

export async function collectImageInputs({ pull, pullImage, inspectImage }) {
  const images = [];
  for (const declared of declaredMutableInputs) {
    try {
      if (pull) {
        await pullImage(declared);
      }
      images.push(resolvedImage(declared, await inspectImage(declared)));
    } catch (error) {
      if (pull) {
        throw error;
      }
      images.push({ declared, state: 'unavailable' });
    }
  }
  return {
    kind: 'playwright-image-inputs',
    resolution: pull ? 'pulled-before-run' : 'cleanup-snapshot',
    complete: images.every(({ state }) => state === 'resolved'),
    images,
  };
}

async function pullImage(declared) {
  await execute('docker', ['pull', declared], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function inspectImage(declared) {
  const { stdout } = await execute('docker', ['image', 'inspect', declared], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const [inspection] = JSON.parse(stdout);
  return inspection;
}

if (
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  const result = await collectImageInputs({
    pull: process.argv.includes('--pull'),
    pullImage,
    inspectImage,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
