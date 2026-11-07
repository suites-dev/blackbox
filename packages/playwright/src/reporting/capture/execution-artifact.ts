import type { TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { digestBytes, type Digest } from '../../envelope/index.js';

export type ExecutionArtifactKind = 'execution-evidence' | 'stimulus-effects' | 'capture-health';
export interface AttachedEvidence {
  readonly kind: 'assertion-evidence' | 'final-snapshot' | ExecutionArtifactKind;
  readonly name: string; readonly sequence: number; readonly digest: Digest; readonly bytes: number;
  readonly outcome: string; readonly evaluation: string; readonly contractDigest: Digest | null;
}
export async function attachExecutionArtifact(input: {
  readonly testInfo: TestInfo; readonly kind: ExecutionArtifactKind; readonly value: unknown;
  readonly sequence: number; readonly sanitize: (text: string) => string;
  readonly register: (item: AttachedEvidence) => void;
}): Promise<Digest> {
  const name = input.kind === 'stimulus-effects' ? 'effects.json' : input.kind === 'capture-health' ? 'blackbox-capture-health' : 'blackbox-execution';
  const body = JSON.stringify(input.value, (_key, field: unknown) => typeof field === 'string' ? input.sanitize(field) : field);
  if (Buffer.byteLength(body) > 1_000_000) { throw new Error('Execution evidence exceeds limits'); }
  const filename = name.endsWith('.json') ? name : `${name}.json`;
  const path = input.testInfo.outputPath('blackbox', 'execution-evidence', String(input.sequence), filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { flag: 'wx', mode: 0o600 });
  await input.testInfo.attach(name, { contentType: 'application/json', body });
  const digest = digestBytes(body);
  input.register({ kind: input.kind, name, sequence: input.sequence, digest, bytes: Buffer.byteLength(body), outcome: '', evaluation: '', contractDigest: null });
  return digest;
}
