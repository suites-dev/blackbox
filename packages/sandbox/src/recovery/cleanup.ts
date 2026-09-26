import { withTimeout } from '../lifecycle/helpers.js';
import type {
  ComposeRecoveryClient,
  OwnedComposeCleanupInput,
  RecoveryResource,
} from './types.js';

const PROJECT_LABEL = 'com.docker.compose.project';

function statusCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? Reflect.get(error, 'statusCode')
    : undefined;
}

function isMissing(error: unknown): boolean {
  return statusCode(error) === 404;
}

function ownsProject(resource: RecoveryResource, projectName: string): boolean {
  return resource.labels.kind === 'available' &&
    resource.labels.values[PROJECT_LABEL] === projectName;
}

function ownershipError(input: {
  readonly kind: 'container' | 'network' | 'volume';
  readonly id: string;
  readonly projectName: string;
}): Error {
  return new Error(
    `Refusing to remove ${input.kind} ${JSON.stringify(input.id)} without exact Compose ` +
    `ownership label ${JSON.stringify(input.projectName)}`,
  );
}

async function inspectOwned<Resource extends RecoveryResource>(input: {
  readonly kind: 'container' | 'network' | 'volume';
  readonly id: string;
  readonly projectName: string;
  readonly inspect: () => Promise<Resource>;
}): Promise<Resource | null> {
  let resource: Resource;
  try {
    resource = await input.inspect();
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
  if (!ownsProject(resource, input.projectName)) {
    throw ownershipError(input);
  }
  return resource;
}

async function removeContainer(input: {
  readonly client: ComposeRecoveryClient;
  readonly id: string;
  readonly projectName: string;
  readonly timeoutSeconds: number;
}): Promise<void> {
  const inspected = await inspectOwned({
    kind: 'container',
    id: input.id,
    projectName: input.projectName,
    inspect: () => input.client.inspectContainer({ id: input.id }),
  });
  if (inspected === null) {
    return;
  }
  if (inspected.running) {
    await input.client.stopContainer({
      id: input.id,
      timeoutSeconds: input.timeoutSeconds,
    }).catch((error: unknown) => {
      if (!isMissing(error) && statusCode(error) !== 304) {
        throw error;
      }
    });
  }
  await input.client.removeContainer({
    id: input.id,
    removeAttachedVolumes: true,
  }).catch((error: unknown) => {
    if (!isMissing(error)) {
      throw error;
    }
  });
}

async function removeResource(input: {
  readonly kind: 'network' | 'volume';
  readonly id: string;
  readonly projectName: string;
  readonly inspect: () => Promise<RecoveryResource>;
  readonly remove: () => Promise<void>;
}): Promise<void> {
  const resource = await inspectOwned(input);
  if (resource === null) {
    return;
  }
  await input.remove().catch((error: unknown) => {
    if (!isMissing(error)) {
      throw error;
    }
  });
}

function failures(results: readonly PromiseSettledResult<void>[]): unknown[] {
  const found: unknown[] = [];
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason;
      found.push(reason);
    }
  }
  return found;
}

async function cleanupOwnedComposeProjectUnbounded(input: {
  readonly cleanup: OwnedComposeCleanupInput;
  readonly client: ComposeRecoveryClient;
}): Promise<void> {
  const { projectName, timeoutMs } = input.cleanup;
  const containerIds = await input.client.listContainers({ projectName });
  const containerResults = await Promise.allSettled(containerIds.map((id) =>
    removeContainer({
      client: input.client,
      id,
      projectName,
      timeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
    }),
  ));
  const [networkIds, volumeIds] = await Promise.all([
    input.client.listNetworks({ projectName }),
    input.client.listVolumes({ projectName }),
  ]);
  const resourceResults = await Promise.allSettled([
    ...networkIds.map((id) => removeResource({
      kind: 'network', id, projectName,
      inspect: () => input.client.inspectNetwork({ id }),
      remove: () => input.client.removeNetwork({ id }),
    })),
    ...volumeIds.map((id) => removeResource({
      kind: 'volume', id, projectName,
      inspect: () => input.client.inspectVolume({ id }),
      remove: () => input.client.removeVolume({ id }),
    })),
  ]);
  const errors = [...failures(containerResults), ...failures(resourceResults)];
  if (errors.length > 0) {
    throw new AggregateError(errors, `Sandbox recovery failed for ${projectName}`);
  }
}

export function cleanupOwnedComposeProject(input: {
  readonly cleanup: OwnedComposeCleanupInput;
  readonly client: ComposeRecoveryClient;
}): Promise<void> {
  return withTimeout({
    operation: cleanupOwnedComposeProjectUnbounded(input),
    timeoutMs: input.cleanup.timeoutMs,
    label: 'Sandbox recovery cleanup',
  });
}
