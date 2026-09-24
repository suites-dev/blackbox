import { join } from 'node:path';

export function sandboxGeneratedComposeDirectory(input: {
  readonly recordDirectory: string;
  readonly sandboxId: string;
}): string {
  return join(input.recordDirectory, `${input.sandboxId}.compose`);
}

export function sandboxTelemetryStorageDirectory(input: {
  readonly recordDirectory: string;
  readonly sandboxId: string;
}): string {
  return join(sandboxGeneratedComposeDirectory(input), 'collector');
}
