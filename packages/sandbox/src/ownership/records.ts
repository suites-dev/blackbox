import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SandboxLifecycleState, SandboxStopReason } from '../types.js';
import { decodeSandboxRecord } from './record-decoder.js';

export interface RecordedError {
  readonly name: string;
  readonly message: string;
}

interface SandboxRecordBase {
  readonly schemaVersion: 1;
  readonly sandboxId: string;
  readonly projectName: string;
  readonly composeFiles: readonly string[];
  readonly state: SandboxLifecycleState;
  readonly revision: number;
  readonly admittedAt: string;
  readonly updatedAt: string;
}

export interface ActiveSandboxRecord extends SandboxRecordBase {
  readonly state: 'admitted' | 'starting' | 'running' | 'stopping';
}

export interface CompletedSandboxRecord extends SandboxRecordBase {
  readonly state: 'completed';
  readonly stopReason: SandboxStopReason;
  readonly cleanup: 'complete';
}

export type CleanupRecord =
  | { readonly kind: 'not-attempted' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'failed'; readonly error: RecordedError };

export interface StartFailedSandboxRecord extends SandboxRecordBase {
  readonly state: 'start-failed';
  readonly primaryError: RecordedError;
  readonly cleanup: CleanupRecord;
}

export interface StopFailedSandboxRecord extends SandboxRecordBase {
  readonly state: 'stop-failed';
  readonly primaryError: RecordedError;
  readonly cleanup: { readonly kind: 'failed'; readonly error: RecordedError };
}

export type FailedSandboxRecord = StartFailedSandboxRecord | StopFailedSandboxRecord;
export type SandboxRecord = ActiveSandboxRecord | CompletedSandboxRecord | FailedSandboxRecord;

export interface InterruptedSandboxRecord {
  readonly status: 'interrupted';
  readonly record: ActiveSandboxRecord;
}

export function recordedError(error: unknown): RecordedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'Error', message: String(error) };
}

export interface SandboxRecordSelector {
  readonly recordDirectory: string;
  readonly sandboxId: string;
}

export interface SandboxRecordWriteInput {
  readonly recordDirectory: string;
  readonly record: SandboxRecord;
}

export function sandboxRecordPath(input: SandboxRecordSelector): string {
  return join(input.recordDirectory, `${input.sandboxId}.json`);
}

export async function writeSandboxRecord(input: SandboxRecordWriteInput): Promise<void> {
  await mkdir(input.recordDirectory, { recursive: true });
  const target = sandboxRecordPath({
    recordDirectory: input.recordDirectory,
    sandboxId: input.record.sandboxId,
  });
  const temporary = `${target}.${process.pid}.${input.record.revision}.tmp`;
  await writeFile(temporary, `${JSON.stringify(input.record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, target);
}

/** Atomically claims a sandbox identity without replacing an earlier execution. */
export async function admitSandboxRecord(input: {
  readonly recordDirectory: string;
  readonly record: ActiveSandboxRecord;
}): Promise<void> {
  await mkdir(input.recordDirectory, { recursive: true });
  const target = sandboxRecordPath({
    recordDirectory: input.recordDirectory,
    sandboxId: input.record.sandboxId,
  });
  const temporary = `${target}.${process.pid}.${input.record.revision}.admission.tmp`;
  await writeFile(temporary, `${JSON.stringify(input.record, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    await link(temporary, target);
  } finally {
    await unlink(temporary);
  }
}

export async function readSandboxRecord(input: SandboxRecordSelector): Promise<SandboxRecord> {
  const bytes = await readFile(sandboxRecordPath(input), 'utf8');
  return decodeSandboxRecord(bytes);
}

function isActive(record: SandboxRecord): record is ActiveSandboxRecord {
  return ['admitted', 'starting', 'running', 'stopping'].includes(record.state);
}

export async function findInterruptedSandboxes(input: {
  readonly recordDirectory: string;
}): Promise<readonly InterruptedSandboxRecord[]> {
  let names: string[];
  try {
    names = await readdir(input.recordDirectory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map(async (name) =>
        decodeSandboxRecord(await readFile(join(input.recordDirectory, name), 'utf8')),
      ),
  );
  return records.filter(isActive).map((record) => ({ status: 'interrupted', record }));
}
