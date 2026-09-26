import { readFile } from 'node:fs/promises';

import { capsuleSessionDirectory, writeJsonArtifact } from '../records.js';
import { decodeCapsuleProgress, type CapsuleProgressDocument } from './schema.js';
import type { CapsuleProgressEvent } from '../types.js';

type WithoutProgressEnvelope<Event> = Event extends CapsuleProgressEvent
  ? Event extends { readonly kind: 'capsule-start-failed' }
    ? Omit<Event, 'sequence' | 'at'>
    : Omit<Event, 'sequence' | 'at' | 'stage'>
  : never;
export type CapsuleProgressEmission = WithoutProgressEnvelope<CapsuleProgressEvent>;

function progressStage(kind: CapsuleProgressEvent['kind']): CapsuleProgressEvent['stage'] {
  if (kind === 'session-admitted') {
    return 'admission';
  }
  if (kind.startsWith('catalog-')) {
    return 'catalog';
  }
  if (kind.startsWith('manager-')) {
    return 'manager';
  }
  if (kind === 'readiness-started' || kind === 'readiness-succeeded') {
    return 'readiness';
  }
  if (kind === 'capsule-ready') {
    return 'ready';
  }
  if (kind === 'capsule-start-failed') {
    return 'persistence';
  }
  return 'acquisition';
}

export function capsuleProgressPath(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): string {
  return `${capsuleSessionDirectory(input)}/progress.json`;
}

export async function readCapsuleProgress(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<readonly CapsuleProgressEvent[]> {
  return decodeCapsuleProgress({
    document: JSON.parse(await readFile(capsuleProgressPath(input), 'utf8')) as unknown,
    sessionId: input.sessionId,
  });
}

async function readProgressForAppend(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
}): Promise<readonly CapsuleProgressEvent[]> {
  try {
    return await readCapsuleProgress(input);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function appendCapsuleProgress(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly event: CapsuleProgressEmission;
}): Promise<CapsuleProgressEvent> {
  const events = await readProgressForAppend(input);
  const event = {
    ...input.event,
    sequence: events.length + 1,
    at: new Date().toISOString(),
    stage:
      input.event.kind === 'capsule-start-failed'
        ? input.event.stage
        : progressStage(input.event.kind),
  } as CapsuleProgressEvent;
  const document = {
    schemaVersion: 1,
    kind: 'capsule-progress',
    events: [...events, event],
  } satisfies CapsuleProgressDocument;
  decodeCapsuleProgress({ document, sessionId: input.sessionId });
  await writeJsonArtifact({
    target: capsuleProgressPath(input),
    revision: event.sequence,
    value: document,
  });
  return event;
}
