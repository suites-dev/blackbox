import { readFile, readdir } from 'node:fs/promises';

import {
  capsuleRecordPath,
  capsuleRuntimeRoot,
  capsuleSessionDirectory,
  recordedError,
  type CapsuleSessionRecord,
} from '../records.js';
import { decodeCapsuleSessionRecord } from '../persistence/decoder.js';
import { canonicalProjectDirectory } from '../session/validation.js';
import type {
  CapsuleRegistryEntry,
  CapsuleRegistryInput,
  CapsuleRegistryResult,
  CapsuleSessionSummary,
} from './types.js';

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function summary(record: CapsuleSessionRecord): CapsuleSessionSummary {
  return {
    sessionId: record.sessionId,
    system: record.system,
    title: record.title,
    description: record.description,
    state: record.state,
    admittedAt: record.admittedAt,
    updatedAt: record.updatedAt,
    artifactRoot: record.artifactRoot,
    cleanup: record.cleanup.kind,
  };
}

async function readEntry(input: {
  readonly projectDirectory: string;
  readonly directoryName: string;
}): Promise<CapsuleRegistryEntry> {
  const directorySessionId = input.directoryName.slice('capsule-'.length);
  try {
    const bytes = await readFile(
      capsuleRecordPath({
        projectDirectory: input.projectDirectory,
        sessionId: directorySessionId,
      }),
      'utf8',
    );
    const record = decodeCapsuleSessionRecord({ bytes });
    if (record.sessionId !== directorySessionId) {
      return {
        kind: 'capsule-session-corrupt',
        directoryName: input.directoryName,
        failure: {
          kind: 'identity-mismatch',
          directorySessionId,
          recordSessionId: record.sessionId,
        },
      };
    }
    const expectedRoot = capsuleSessionDirectory({
      projectDirectory: input.projectDirectory,
      sessionId: directorySessionId,
    });
    if (record.artifactRoot !== expectedRoot) {
      throw new Error('Capsule session record artifactRoot does not match its registry directory');
    }
    return { kind: 'capsule-session-summary', summary: summary(record) };
  } catch (error) {
    return {
      kind: 'capsule-session-corrupt',
      directoryName: input.directoryName,
      failure: {
        kind: isMissing(error) ? 'record-missing' : 'record-corrupt',
        error: recordedError(error),
      },
    };
  }
}

function orderEntries(entries: readonly CapsuleRegistryEntry[]): readonly CapsuleRegistryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind === 'capsule-session-summary' && right.kind === 'capsule-session-summary') {
      return (
        right.summary.admittedAt.localeCompare(left.summary.admittedAt) ||
        left.summary.sessionId.localeCompare(right.summary.sessionId)
      );
    }
    if (left.kind === 'capsule-session-summary') {
      return -1;
    }
    if (right.kind === 'capsule-session-summary') {
      return 1;
    }
    return left.directoryName.localeCompare(right.directoryName);
  });
}

export async function listCapsuleSessions(
  input: CapsuleRegistryInput,
): Promise<CapsuleRegistryResult> {
  try {
    const projectDirectory = await canonicalProjectDirectory(input.projectDirectory);
    let directories;
    try {
      directories = await readdir(capsuleRuntimeRoot({ projectDirectory }), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissing(error)) {
        return { kind: 'capsule-session-registry', projectDirectory, entries: [] };
      }
      throw error;
    }
    const names = directories
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('capsule-'))
      .map(({ name }) => name);
    const entries = await Promise.all(
      names.map((directoryName) => readEntry({ projectDirectory, directoryName })),
    );
    return { kind: 'capsule-session-registry', projectDirectory, entries: orderEntries(entries) };
  } catch (error) {
    return { kind: 'capsule-registry-failed', error: recordedError(error) };
  }
}
