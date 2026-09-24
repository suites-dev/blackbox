import { join } from 'node:path';
import type { CollectorIdentity } from '../model/types.js';

export function sessionDirectory(
  input: CollectorIdentity & { readonly storageDirectory: string },
): string {
  return join(input.storageDirectory, input.sessionId, input.executionId);
}

export function lifecyclePath(
  input: CollectorIdentity & { readonly storageDirectory: string },
): string {
  return join(sessionDirectory(input), 'collector-lifecycle.json');
}

export function lockPath(input: CollectorIdentity & { readonly storageDirectory: string }): string {
  return join(sessionDirectory(input), 'collector.lock');
}

export function fragmentDirectory(
  input: CollectorIdentity & { readonly storageDirectory: string },
): string {
  return join(sessionDirectory(input), 'fragments');
}

export function fragmentName(sequence: number): string {
  return `${String(sequence).padStart(12, '0')}.json`;
}
