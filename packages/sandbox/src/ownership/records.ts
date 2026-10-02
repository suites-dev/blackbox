import { link, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeSandboxRecord } from './record-decoder.js';
import { replaceFile } from './replace-file.js';
import type {
  RecordedError,
  ActiveSandboxRecord,
  SandboxRecord,
  InterruptedSandboxRecord,
} from './record-types.js';

export type {
  RecordedError,
  ActiveSandboxRecord,
  CompletedSandboxRecord,
  CleanupRecord,
  StartFailedSandboxRecord,
  StopFailedSandboxRecord,
  FailedSandboxRecord,
  SandboxRecord,
  InterruptedSandboxRecord,
} from './record-types.js';

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
  await replaceFile(temporary, target);
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
