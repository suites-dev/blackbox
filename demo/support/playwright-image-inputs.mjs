import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const declaredMutableInputs = [
  'localstack/localstack:3.8',
  'node:22.22.0-bookworm-slim',
  'postgres:16-alpine',
  'rabbitmq:4.1-alpine',
  'redis:7-alpine',
];
const pull = process.argv.includes('--pull');

const images = [];
for (const declared of declaredMutableInputs) {
  if (pull) {
    await execute('docker', ['pull', declared], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  const { stdout } = await execute('docker', ['image', 'inspect', declared], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  const [inspection] = JSON.parse(stdout);
  if (typeof inspection?.Id !== 'string' || !inspection.Id.startsWith('sha256:')) {
    throw new Error(`Docker did not resolve an immutable image ID for ${declared}`);
  }
  images.push({
    declared,
    imageId: inspection.Id,
    repoDigests: [...(inspection.RepoDigests ?? [])].sort(),
    repoTags: [...(inspection.RepoTags ?? [])].sort(),
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      kind: 'playwright-image-inputs',
      resolution: pull ? 'pulled-before-run' : 'locally-resolved-during-cleanup',
      images,
    },
    null,
    2,
  )}\n`,
);
