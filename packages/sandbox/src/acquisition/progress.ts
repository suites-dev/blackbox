import type { ComposeAcquisitionObservation } from './observation.js';
import type { SandboxContainer } from '../types.js';
import type { SandboxResourceInspectionResult } from '../inspection/resources.js';

interface SandboxProgressEventBase {
  readonly sandboxId: string;
  readonly projectName: string;
  readonly at: string;
}

export type SandboxProgressEvent =
  | (SandboxProgressEventBase & { readonly kind: 'acquisition-started' })
  | (SandboxProgressEventBase & {
      readonly kind: 'acquisition-observation';
      readonly observation: ComposeAcquisitionObservation;
    })
  | (SandboxProgressEventBase & {
      readonly kind: 'containers-acquired';
      readonly containers: readonly SandboxContainer[];
    })
  | (SandboxProgressEventBase & {
      readonly kind: 'resources-ready';
      readonly resources: SandboxResourceInspectionResult;
    })
  | (SandboxProgressEventBase & {
      readonly kind: 'acquisition-failed';
      readonly error: { readonly name: string; readonly message: string };
    });

export interface SandboxProgressSink {
  emit(input: SandboxProgressEvent): void;
}

export type SandboxProgressMode =
  | { readonly kind: 'silent' }
  | { readonly kind: 'events'; readonly sink: SandboxProgressSink };

export function emitProgress(input: {
  readonly mode: SandboxProgressMode;
  readonly event: SandboxProgressEvent;
}): void {
  switch (input.mode.kind) {
    case 'silent':
      return;
    case 'events':
      try {
        input.mode.sink.emit(input.event);
      } catch {
        // Presentation must not change acquisition or cleanup truth.
      }
  }
}

export function progressCoordinates(input: {
  readonly source: { readonly sandboxId: string; readonly projectName: string };
  readonly now: () => Date;
}): SandboxProgressEventBase {
  return {
    sandboxId: input.source.sandboxId,
    projectName: input.source.projectName,
    at: input.now().toISOString(),
  };
}
