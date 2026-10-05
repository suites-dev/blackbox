import { inspectComposeProject, type ComposeObservationSnapshot } from '@suites/blackbox-sandbox';

import type { CapsuleContainerDetails } from '../model/environment.js';
import type { CapsuleProgressEvent } from '../progress/events.js';
import { appendCapsuleProgress, readCapsuleProgress } from '../progress/store.js';
import type { CapsuleSessionRecord } from '../persistence/session-record.js';
import {
  canonicalProjectDirectory,
  isFailure,
  readRecordOrNotFound,
  validateSessionId,
} from './validation.js';

/** A participant container that stopped, died or disappeared while its capsule ran. */
export interface CapsuleParticipantExit {
  readonly participant: string;
  readonly service: string;
  readonly containerName: string;
  readonly containerId: string;
  readonly state: 'exited' | 'dead' | 'missing';
  /** Null when the container is gone and its exit code is unknown. */
  readonly exitCode: number | null;
}

export type CapsuleParticipantCheck =
  | { readonly kind: 'participants-checked'; readonly exited: readonly CapsuleParticipantExit[] }
  | { readonly kind: 'participants-not-running'; readonly state: CapsuleSessionRecord['state'] }
  | { readonly kind: 'participants-unavailable'; readonly message: string };

/** Reads the Docker state of a capsule's Compose project. */
export type CapsuleContainerInspector = (input: {
  readonly projectName: string;
}) => Promise<ComposeObservationSnapshot>;

const INSPECTION_TIMEOUT_MS = 5_000;

/**
 * The only Docker query this check makes: every container of the capsule's
 * Compose project with its state and exit code. Kept as one function so a
 * verified cleanup query (#89) can share or replace it.
 */
export const inspectCapsuleContainers: CapsuleContainerInspector = ({ projectName }) =>
  inspectComposeProject({ projectName, timeoutMs: INSPECTION_TIMEOUT_MS });

/** The recorded participants whose container is no longer running. */
export function exitedParticipants(
  containers: readonly CapsuleContainerDetails[],
  snapshot: ComposeObservationSnapshot,
): readonly CapsuleParticipantExit[] {
  return containers.flatMap((container): readonly CapsuleParticipantExit[] => {
    const observed = snapshot.containers.find((item) => item.containerId === container.containerId);
    const identity = {
      participant: container.participant,
      service: container.service,
      containerName: container.containerName,
      containerId: container.containerId,
    };
    if (observed === undefined) {
      return [{ ...identity, state: 'missing' as const, exitCode: null }];
    }
    if (observed.state !== 'exited' && observed.state !== 'dead') {
      return [];
    }
    const exitCode = observed.termination.kind === 'exited' ? observed.termination.exitCode : null;
    return [{ ...identity, state: observed.state, exitCode }];
  });
}

/** Appends one `participant-exited` event per container not already recorded. */
async function recordExits(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly exited: readonly CapsuleParticipantExit[];
}): Promise<void> {
  const progress: readonly CapsuleProgressEvent[] = await readCapsuleProgress(input);
  const recorded = new Set(
    progress.flatMap((event) => (event.kind === 'participant-exited' ? [event.containerId] : [])),
  );
  for (const exit of input.exited.filter((item) => !recorded.has(item.containerId))) {
    await appendCapsuleProgress({
      projectDirectory: input.projectDirectory,
      sessionId: input.sessionId,
      event: { kind: 'participant-exited', sessionId: input.sessionId, ...exit },
    });
  }
}

/**
 * Checks a running capsule's participant containers against Docker, records
 * each newly exited one as a `participant-exited` progress event, and returns
 * every exited participant. Read-only towards Docker; never stops anything.
 */
export async function checkCapsuleParticipants(
  input: { readonly projectDirectory: string; readonly sessionId: string },
  inspect: CapsuleContainerInspector = inspectCapsuleContainers,
): Promise<CapsuleParticipantCheck> {
  try {
    validateSessionId(input.sessionId);
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    const record = await readRecordOrNotFound({ projectDirectory, sessionId: input.sessionId });
    if (isFailure(record)) {
      return { kind: 'participants-unavailable', message: record.kind };
    }
    if (record.state !== 'running') {
      return { kind: 'participants-not-running', state: record.state };
    }
    if (record.composeProject.kind !== 'available') {
      return { kind: 'participants-unavailable', message: 'Compose project is not recorded' };
    }
    const snapshot = await inspect({ projectName: record.composeProject.value });
    const exited = exitedParticipants(record.containers, snapshot);
    await recordExits({ projectDirectory, sessionId: input.sessionId, exited });
    return { kind: 'participants-checked', exited };
  } catch (error) {
    return {
      kind: 'participants-unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
