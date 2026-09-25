import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { packagedCollectorRuntime } from '@suites/blackbox-otel-collector-internal';

export type CapsuleCollectorRuntime =
  | { readonly kind: 'image-default'; readonly image: string }
  | {
      readonly kind: 'mounted-node';
      readonly image: string;
      readonly sourceDirectory: string;
      readonly targetDirectory: string;
      readonly entrypoint: string;
      readonly user: string;
    };

export type CapsuleCollectorRuntimeReadiness =
  | { readonly kind: 'ready'; readonly runtime: CapsuleCollectorRuntime }
  | {
      readonly kind: 'unavailable';
      readonly error: { readonly name: string; readonly message: string };
    };

export interface CapsuleCollectorRuntimePort {
  resolve(): Promise<CapsuleCollectorRuntimeReadiness>;
}

const NODE_RUNTIME_IMAGE =
  'docker.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402';

// The collector writes its session storage into a bind mount owned by whoever
// runs the Capsule. The image's own `node` account is uid 1000, which cannot
// write that directory on a Linux host whose user is any other uid, so the
// container runs as the calling user instead.
function callingUser(): string {
  const readUserId = process.getuid;
  const readGroupId = process.getgid;
  if (readUserId === undefined || readGroupId === undefined) {
    throw new Error('A Capsule collector requires a POSIX host to own its telemetry storage.');
  }
  return `${readUserId.call(process)}:${readGroupId.call(process)}`;
}

export const nodeCapsuleCollectorRuntime = {
  async resolve(): Promise<CapsuleCollectorRuntimeReadiness> {
    const packaged = packagedCollectorRuntime();
    try {
      await access(join(packaged.directory, packaged.entrypoint));
      return {
        kind: 'ready',
        runtime: {
          kind: 'mounted-node',
          image: NODE_RUNTIME_IMAGE,
          sourceDirectory: packaged.directory,
          targetDirectory: '/blackbox/collector',
          entrypoint: packaged.entrypoint,
          user: callingUser(),
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'unavailable', error: { name: 'CollectorRuntimeUnavailable', message } };
    }
  },
} satisfies CapsuleCollectorRuntimePort;

export function requireCollectorRuntime(
  readiness: CapsuleCollectorRuntimeReadiness,
): CapsuleCollectorRuntime {
  if (readiness.kind === 'ready') {
    return readiness.runtime;
  }
  throw new Error(`${readiness.error.name}: ${readiness.error.message}`);
}
