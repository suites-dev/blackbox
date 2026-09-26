import { readFile, readlink } from 'node:fs/promises';
import type { LeaseRuntime, LinuxProcessOwner, ProcessInspection } from './types.js';
import { randomUUID } from 'node:crypto';

export function classifySignalFailure(error: unknown): 'alive' | 'missing' | 'unavailable' {
  if (!(error instanceof Error && 'code' in error)) {
    return 'unavailable';
  }
  if (error.code === 'EPERM') {
    return 'alive';
  }
  return error.code === 'ESRCH' ? 'missing' : 'unavailable';
}

function fallbackInspection(pid: number): ProcessInspection {
  try {
    process.kill(pid, 0);
    return { kind: 'process-alive-unidentified', pid };
  } catch (error) {
    const classification = classifySignalFailure(error);
    if (classification === 'alive') {
      return { kind: 'process-alive-unidentified', pid };
    }
    return classification === 'missing'
      ? { kind: 'process-missing', pid }
      : { kind: 'process-inspection-unavailable', pid };
  }
}

export function parseLinuxStartTime(stat: string): string | null {
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd < 0) {
    return null;
  }
  const fieldsFromState = stat.slice(commandEnd + 1).trim().split(/\s+/u);
  const startTime = fieldsFromState.at(19);
  return startTime !== undefined && /^\d+$/u.test(startTime) ? startTime : null;
}

async function linuxOwner(pid: number): Promise<LinuxProcessOwner | null> {
  try {
    const [bootId, stat, pidNamespace] = await Promise.all([
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readFile(`/proc/${String(pid)}/stat`, 'utf8'),
      readlink(`/proc/${String(pid)}/ns/pid`),
    ]);
    const startTimeTicks = parseLinuxStartTime(stat);
    const normalizedBootId = bootId.trim();
    return startTimeTicks === null || normalizedBootId.length === 0
      ? null
      : {
          kind: 'linux-process-instance',
          pid,
          pidNamespace,
          bootId: normalizedBootId,
          startTimeTicks,
        };
  } catch {
    return null;
  }
}

export async function inspectProcess(input: { readonly pid: number }): Promise<ProcessInspection> {
  const owner = process.platform === 'linux' ? await linuxOwner(input.pid) : null;
  if (owner !== null) {
    return { kind: 'process-instance-observed', owner };
  }
  return fallbackInspection(input.pid);
}

export async function createLeaseRuntime(): Promise<LeaseRuntime> {
  const current = await inspectProcess({ pid: process.pid });
  if (current.kind === 'process-missing') {
    throw new Error('Cannot identify the running collector process.');
  }
  const currentOwner =
    current.kind === 'process-instance-observed'
      ? current.owner
      : { kind: 'pid-only-process', pid: current.pid } as const;
  return {
    currentOwner,
    inspectProcess,
    createToken: randomUUID,
    now: () => new Date().toISOString(),
    nowMilliseconds: Date.now,
    heartbeatIntervalMs: 5000,
    staleAfterMs: 30_000,
  };
}
