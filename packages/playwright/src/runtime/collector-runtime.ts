import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { packagedCollectorRuntime } from '@suites/blackbox-otel-collector';
import type { SandboxCollectorRuntime } from '@suites/blackbox-sandbox';

const NODE_RUNTIME_IMAGE =
  'docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';

function collectorContainerUser(): string {
  const readUserId = process.getuid;
  const readGroupId = process.getgid;
  if (readUserId === undefined || readGroupId === undefined) {
    return 'node';
  }
  return `${readUserId.call(process)}:${readGroupId.call(process)}`;
}

export async function resolveCollectorRuntime(): Promise<SandboxCollectorRuntime> {
  const packaged = packagedCollectorRuntime();
  await access(join(packaged.directory, packaged.entrypoint));
  return {
    kind: 'mounted-node',
    image: NODE_RUNTIME_IMAGE,
    sourceDirectory: packaged.directory,
    targetDirectory: '/blackbox/collector',
    entrypoint: packaged.entrypoint,
    user: collectorContainerUser(),
  };
}
