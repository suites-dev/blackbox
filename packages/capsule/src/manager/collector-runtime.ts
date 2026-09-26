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

type CollectorHostIdentity =
  | { readonly kind: 'posix'; readonly userId: number; readonly groupId: number }
  | { readonly kind: 'non-posix' };

function collectorHostIdentity(): CollectorHostIdentity {
  const readUserId = process.getuid;
  const readGroupId = process.getgid;
  if (readUserId === undefined || readGroupId === undefined) {
    return { kind: 'non-posix' };
  }
  return {
    kind: 'posix',
    userId: readUserId.call(process),
    groupId: readGroupId.call(process),
  };
}

// A POSIX bind mount keeps host ownership, so the collector must use that
// exact uid:gid to retain telemetry. Docker Desktop translates bind-mount
// access on non-POSIX hosts, where Node exposes no numeric host identity and
// the image's unprivileged account remains the portable choice.
export function collectorContainerUser(input: CollectorHostIdentity): string {
  return input.kind === 'posix' ? `${input.userId}:${input.groupId}` : 'node';
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
          user: collectorContainerUser(collectorHostIdentity()),
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
