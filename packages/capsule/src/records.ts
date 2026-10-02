import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { replaceFile } from '@suites/blackbox-sandbox';

import type { CapsuleActivityReport } from './model/execution/activity.js';
import type { CapsuleRecordedError } from './model/recorded-error.js';
import { decodeCapsuleActivities } from './persistence/activity-decoder.js';
import { decodeCapsuleSessionRecord } from './persistence/decoder.js';
import type { CapsuleSessionRecord } from './persistence/session-record.js';

export type { CapsuleSessionRecord } from './persistence/session-record.js';

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

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\';

/** True for a Windows named-pipe endpoint, which has no filesystem entry to create or unlink. */
export function isWindowsPipePath(path: string): boolean {
  return path.startsWith(WINDOWS_PIPE_PREFIX);
}

export function capsuleSocketPath(
  input: CapsuleSessionSelector,
  platform: NodeJS.Platform = process.platform,
): string {
  const projectDirectory = resolve(input.projectDirectory);
  if (platform === 'win32') {
    // Windows has no Unix-domain socket files usable by Node; named pipes share
    // one machine-wide namespace, so the name binds project and session.
    const digest = createHash('sha256')
      .update(`${projectDirectory}\0${input.sessionId}`)
      .digest('hex')
      .slice(0, 32);
    return `${WINDOWS_PIPE_PREFIX}bb-${digest}`;
  }
  const digest = createHash('sha256').update(input.sessionId).digest('hex').slice(0, 16);
  return join(projectDirectory, '.blackbox', 'tmp', `bb-${digest}.sock`);
}

export function capsuleActivityPath(input: CapsuleSessionSelector): string {
  return join(capsuleSessionDirectory(input), 'activities.json');
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : '';
}

function within(path: string, root: string): boolean {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

async function safeSessionDirectory(input: CapsuleSessionSelector): Promise<string> {
  const root = resolve(await realpath(input.projectDirectory));
  let directory = root;
  for (const name of ['.blackbox', 'experiments', `capsule-${input.sessionId}`]) {
    const path = join(directory, name);
    await mkdir(path, { mode: 0o700 }).catch((error: unknown) => {
      if (errorCode(error) !== 'EEXIST') {
        throw error;
      }
    });
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Refusing unsafe Capsule state directory: ${path}`);
    }
    directory = resolve(await realpath(path));
    if (!within(directory, root)) {
      throw new Error(`Capsule state directory escapes the project: ${path}`);
    }
  }
  return directory;
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
  await replaceFile(temporary, input.target);
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
  const selector = {
    projectDirectory: input.projectDirectory,
    sessionId: input.record.sessionId,
  } satisfies CapsuleSessionSelector;
  const directory = await safeSessionDirectory(selector);
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
  await writeCapsuleActivities({
    ...selector,
    activities: [],
  });
  await writeJsonArtifact({
    target: join(directory, 'progress.json'),
    revision: 0,
    value: { schemaVersion: 1, kind: 'capsule-progress', events: [] },
  });
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
  return decodeCapsuleSessionRecord({ bytes: await readFile(capsuleRecordPath(input), 'utf8') });
}

export async function readCapsuleActivities(
  input: CapsuleSessionSelector,
): Promise<readonly CapsuleActivityReport[]> {
  return decodeCapsuleActivities({ bytes: await readFile(capsuleActivityPath(input), 'utf8') });
}

export async function writeCapsuleActivities(input: {
  readonly projectDirectory: string;
  readonly sessionId: string;
  readonly activities: readonly CapsuleActivityReport[];
}): Promise<void> {
  decodeCapsuleActivities({ bytes: JSON.stringify(input.activities) });
  await atomicWrite({
    target: capsuleActivityPath(input),
    revision: input.activities.length,
    bytes: `${JSON.stringify(input.activities, null, 2)}\n`,
  });
}
