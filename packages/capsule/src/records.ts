import { link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

import type {
  CapsuleActivityReport,
  CapsuleCleanupReport,
  CapsuleContainerDetails,
  CapsuleEntrypoint,
  CapsuleReadinessDetails,
  CapsuleRecordedError,
  CapsuleSessionState,
} from './types.js';

export interface CapsuleSessionRecord {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  /** Internal resource identity. It is retained but omitted from public results. */
  readonly executionId: string;
  readonly system: string;
  readonly title: string | undefined;
  readonly description: string | undefined;
  readonly state: CapsuleSessionState;
  readonly revision: number;
  readonly admittedAt: string;
  readonly updatedAt: string;
  readonly managerPid: number | undefined;
  readonly socketPath: string;
  readonly entrypoint: CapsuleEntrypoint | undefined;
  readonly containers: readonly CapsuleContainerDetails[];
  readonly cleanup: CapsuleCleanupReport;
  readonly error: CapsuleRecordedError | undefined;
  readonly composeProject: string | undefined;
  readonly artifactRoot: string;
  readonly networks: readonly string[];
  readonly volumes: readonly string[];
  readonly readiness: CapsuleReadinessDetails | undefined;
}

export interface CapsuleSessionSelector {
  readonly projectDirectory: string;
  readonly sessionId: string;
}

export interface CapsuleRecordWriteInput {
  readonly projectDirectory: string;
  readonly record: CapsuleSessionRecord;
}

export function recordedError(error: unknown): CapsuleRecordedError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

export function capsuleRuntimeRoot(input: { readonly projectDirectory: string }): string {
  return resolve(input.projectDirectory, '.blackbox', 'experiments');
}

export function capsuleSessionDirectory(input: CapsuleSessionSelector): string {
  return join(capsuleRuntimeRoot(input), `capsule-${input.sessionId}`);
}

export function capsuleRecordPath(input: CapsuleSessionSelector): string {
  return join(capsuleSessionDirectory(input), 'session.json');
}

export function capsuleSocketPath(input: CapsuleSessionSelector): string {
  const digest = createHash('sha256').update(input.sessionId).digest('hex').slice(0, 16);
  return join(resolve(input.projectDirectory, '.blackbox', 's'), `bb-${digest}.sock`);
}

export function capsuleActivityPath(input: CapsuleSessionSelector): string {
  return join(capsuleSessionDirectory(input), 'activities.json');
}

export function capsuleSandboxRecordDirectory(input: CapsuleSessionSelector): string {
  return join(capsuleSessionDirectory(input), 'sandbox');
}

async function atomicWrite(input: {
  readonly target: string;
  readonly revision: number;
  readonly bytes: string;
}): Promise<void> {
  const temporary = `${input.target}.${process.pid}.${input.revision}.tmp`;
  await writeFile(temporary, input.bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await rename(temporary, input.target);
}

export async function writeJsonArtifact(input: {
  readonly target: string;
  readonly revision: number;
  readonly value: unknown;
}): Promise<void> {
  await atomicWrite({
    target: input.target,
    revision: input.revision,
    bytes: `${JSON.stringify(input.value, null, 2)}\n`,
  });
}

export async function admitCapsuleRecord(input: CapsuleRecordWriteInput): Promise<void> {
  const directory = capsuleSessionDirectory({
    projectDirectory: input.projectDirectory,
    sessionId: input.record.sessionId,
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = capsuleRecordPath({
    projectDirectory: input.projectDirectory,
    sessionId: input.record.sessionId,
  });
  const temporary = `${target}.${process.pid}.admission.tmp`;
  await writeFile(temporary, `${JSON.stringify(input.record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
}

export async function writeCapsuleRecord(input: CapsuleRecordWriteInput): Promise<void> {
  await atomicWrite({
    target: capsuleRecordPath({
      projectDirectory: input.projectDirectory,
      sessionId: input.record.sessionId,
    }),
    revision: input.record.revision,
    bytes: `${JSON.stringify(input.record, null, 2)}\n`,
  });
}

export async function readCapsuleRecord(
  input: CapsuleSessionSelector,
): Promise<CapsuleSessionRecord> {
  return JSON.parse(await readFile(capsuleRecordPath(input), 'utf8')) as CapsuleSessionRecord;
}

export async function readCapsuleActivities(
  input: CapsuleSessionSelector,
): Promise<readonly CapsuleActivityReport[]> {
  try {
    return JSON.parse(
      await readFile(capsuleActivityPath(input), 'utf8'),
    ) as CapsuleActivityReport[];
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function writeCapsuleActivities(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activities: readonly CapsuleActivityReport[];
}): Promise<void> {
  await atomicWrite({
    target: capsuleActivityPath(input),
    revision: input.activities.length,
    bytes: `${JSON.stringify(input.activities, null, 2)}\n`,
  });
}
