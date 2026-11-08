import type { TestInfo } from '@playwright/test';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digestBytes, type Digest } from '../../envelope/index.js';
import type { CaptureLease } from '../../capture/operations.js';

export type ExecutionArtifactKind = 'execution-evidence' | 'stimulus-effects' | 'capture-health';
export interface AttachedEvidence {
  readonly kind: 'assertion-evidence' | 'final-snapshot' | ExecutionArtifactKind;
  readonly name: string; readonly sequence: number; readonly digest: Digest; readonly bytes: number;
  readonly outcome: string; readonly evaluation: string; readonly contractDigest: Digest | null;
}

async function writeEvidence(path: string, body: string, lease: CaptureLease | undefined): Promise<void> {
  const file = await open(path, 'wx', 0o600);
  try {
    try {
      if (lease !== undefined) { lease.check(); }
      await file.writeFile(body, { signal: lease === undefined ? undefined : lease.signal });
      if (lease !== undefined) { lease.check(); }
    } finally { await file.close(); }
  } catch (error) {
    // This handle was exclusively created by this operation; never leave an aborted JSON fragment.
    await rm(path);
    throw error;
  }
}

export async function attachExecutionArtifact(input: {
  readonly testInfo: TestInfo; readonly kind: ExecutionArtifactKind; readonly value: unknown;
  readonly sequence: number; readonly sanitize: (text: string) => string;
  readonly register: (item: AttachedEvidence) => void;
} & Readonly<Partial<{ lease: CaptureLease }>>): Promise<Digest> {
  const check = (): void => { if (input.lease !== undefined) { input.lease.check(); } };
  check();
  const name = input.kind === 'stimulus-effects' ? 'effects.json' : input.kind === 'capture-health' ? 'blackbox-capture-health' : 'blackbox-execution';
  const body = JSON.stringify(input.value, (_key, field: unknown) => typeof field === 'string' ? input.sanitize(field) : field);
  if (Buffer.byteLength(body) > 1_000_000) { throw new Error('Execution evidence exceeds limits'); }
  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const path = input.testInfo.outputPath('blackbox', 'execution-evidence', String(input.sequence), filename);
  await mkdir(dirname(path), { recursive: true });
  check();
  await writeEvidence(path, body, input.lease);
  try {
    check();
    await input.testInfo.attach(name, { contentType: 'application/json', body });
    check();
  } catch (error) {
    if (input.lease !== undefined && input.lease.signal.aborted) { await rm(path); }
    throw error;
  }
  const digest = digestBytes(body);
  input.register({ kind: input.kind, name, sequence: input.sequence, digest, bytes: Buffer.byteLength(body), outcome: '', evaluation: '', contractDigest: null });
  return digest;
}
