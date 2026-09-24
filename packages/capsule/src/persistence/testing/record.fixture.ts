import { capsuleSessionDirectory, type CapsuleSessionRecord } from '../../records.js';

export function retainedRecord(projectDirectory: string): CapsuleSessionRecord {
  const selector = { projectDirectory, sessionId: 'quiet-river-ada' };
  return {
    schemaVersion: 1,
    sessionId: selector.sessionId,
    executionId: '11111111-1111-4111-8111-111111111111',
    system: 'orders',
    title: 'Orders experiment',
    description: { kind: 'omitted' },
    state: 'admitted',
    revision: 0,
    admittedAt: '2026-09-23T12:00:00.000Z',
    updatedAt: '2026-09-23T12:00:00.000Z',
    manager: { kind: 'not-started' },
    socketPath: '/tmp/unstarted.sock',
    entrypoint: { kind: 'unavailable' },
    containers: [],
    cleanup: { kind: 'not-attempted' },
    failure: { kind: 'none' },
    composeProject: { kind: 'unavailable' },
    artifactRoot: capsuleSessionDirectory(selector),
    networks: [],
    volumes: [],
    readiness: { kind: 'unavailable' },
  };
}
