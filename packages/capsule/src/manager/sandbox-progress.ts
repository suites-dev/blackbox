import type { CatalogEntry } from '@suites/blackbox-catalog-internal';
import type { SandboxProgressEvent, SandboxProgressMode } from '@suites/blackbox-sandbox-internal';

import type { CapsuleManagerBootstrap } from '../protocol.js';
import { emitProgress } from './progress.js';

function participantForService(entry: CatalogEntry, service: string): string {
  const match = Object.entries(entry.participants).find(([, value]) => value.service === service);
  if (match === undefined) {
    return service; // Compose dependencies may have no separately declared participant.
  }
  return match[0];
}

async function forward(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly entry: CatalogEntry;
  readonly event: SandboxProgressEvent;
}): Promise<void> {
  switch (input.event.kind) {
    case 'acquisition-started':
      return;
    case 'acquisition-observation':
      await emitProgress(input.bootstrap, {
        kind: 'acquisition-observation', sessionId: input.bootstrap.sessionId,
        observation: input.event.observation.kind === 'service-state'
          ? { ...input.event.observation, participant: participantForService(input.entry, input.event.observation.container.service) }
          : input.event.observation,
      });
      return;
    case 'containers-acquired':
      for (const container of input.event.containers) {
        await emitProgress(input.bootstrap, {
          kind: 'container-acquired',
          sessionId: input.bootstrap.sessionId,
          participant: participantForService(input.entry, container.service),
          service: container.service,
          containerId: container.testcontainer.id,
          containerName: container.testcontainer.name,
          networkNames: container.testcontainer.networkNames,
        });
      }
      return;
    case 'resources-ready':
      for (const resource of [
        ...input.event.resources.networks,
        ...input.event.resources.volumes,
      ]) {
        await emitProgress(input.bootstrap, {
          kind: 'resource-owned',
          sessionId: input.bootstrap.sessionId,
          resource: { kind: resource.kind, name: resource.name },
        });
      }
      return;
    case 'acquisition-failed':
      return;
  }
}

export function sandboxProgressBridge(input: {
  readonly bootstrap: CapsuleManagerBootstrap;
  readonly entry: CatalogEntry;
}): { readonly mode: SandboxProgressMode; readonly flush: () => Promise<void> } {
  let pending = Promise.resolve();
  let failure: { readonly kind: 'none' } | { readonly kind: 'failed'; readonly error: unknown };
  failure = { kind: 'none' };
  return {
    mode: {
      kind: 'events',
      sink: {
        emit: (event) => {
          pending = pending.then(async () => {
            if (failure.kind === 'failed') { return; }
            try { await forward({ ...input, event }); }
            catch (error) { failure = { kind: 'failed', error }; }
          });
        },
      },
    },
    flush: async () => {
      await pending;
      if (failure.kind === 'failed') { throw failure.error; }
    },
  };
}
