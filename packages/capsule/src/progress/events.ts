import type { CapsuleEntrypoint } from '../model/environment.js';
import type { CapsuleRecordedError } from '../model/recorded-error.js';
import type { CapsuleAcquisitionObservation } from './acquisition.js';

export type CapsuleProgressMode =
  | { readonly kind: 'silent' }
  | { readonly kind: 'interactive'; readonly sink: (event: CapsuleProgressEvent) => void }
  | { readonly kind: 'non-interactive'; readonly sink: (event: CapsuleProgressEvent) => void };

export type CapsuleProgressStage =
  | 'admission'
  | 'catalog'
  | 'manager'
  | 'acquisition'
  | 'readiness'
  | 'ready'
  | 'catalog-load'
  | 'catalog-resolution'
  | 'manager-spawn'
  | 'manager-handshake'
  | 'persistence'
  | 'running';

interface CapsuleProgressBase {
  readonly sessionId: string;
  readonly sequence: number;
  readonly at: string;
  readonly stage: CapsuleProgressStage;
}

export type CapsuleStartFailureStage =
  | 'admission'
  | 'catalog-load'
  | 'catalog-resolution'
  | 'manager-spawn'
  | 'manager-handshake'
  | 'acquisition'
  | 'readiness'
  | 'persistence';

export type CapsuleProgressEvent =
  | (CapsuleProgressBase & {
      readonly kind: 'session-admitted';
      readonly system: string;
      readonly artifactRoot: string;
      readonly environmentKeys: readonly string[];
    })
  | (CapsuleProgressBase & { readonly kind: 'manager-spawned'; readonly managerPid: number })
  | (CapsuleProgressBase & { readonly kind: 'manager-ready'; readonly managerPid: number })
  | (CapsuleProgressBase & {
      readonly kind: 'catalog-selected';
      readonly system: string;
      readonly configFile: string;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'catalog-resolved';
      readonly system: string;
      readonly projectDirectory: string;
      readonly composeFiles: readonly string[];
      readonly services: readonly string[];
    })
  | (CapsuleProgressBase & { readonly kind: 'compose-configured'; readonly projectName: string })
  | (CapsuleProgressBase & { readonly kind: 'acquisition-started'; readonly projectName: string })
  | (CapsuleProgressBase & {
      readonly kind: 'acquisition-observation';
      readonly observation: CapsuleAcquisitionObservation;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'container-acquired';
      readonly participant: string;
      readonly service: string;
      readonly containerName: string;
      readonly containerId: string;
      readonly networkNames: readonly string[];
    })
  | (CapsuleProgressBase & {
      /**
       * Compose start-up and the Testcontainers port checks finished. Their budget
       * is separate from the HTTP readiness timeout that follows.
       */
      readonly kind: 'acquisition-completed';
      readonly durationMs: number;
      readonly startupTimeoutMs: number;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'endpoint-mapped';
      readonly endpoint: CapsuleEntrypoint;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'resource-owned';
      readonly resource:
        | { readonly kind: 'network'; readonly name: string }
        | { readonly kind: 'volume'; readonly name: string };
    })
  | (CapsuleProgressBase & {
      readonly kind: 'readiness-started';
      readonly url: string;
      readonly timeoutMs: number;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'readiness-succeeded';
      readonly url: string;
      readonly durationMs: number;
    })
  | (CapsuleProgressBase & { readonly kind: 'capsule-ready'; readonly durationMs: number })
  | (CapsuleProgressBase & {
      /** A participant container stopped or disappeared while the capsule was running. */
      readonly kind: 'participant-exited';
      readonly participant: string;
      readonly service: string;
      readonly containerName: string;
      readonly containerId: string;
      readonly state: 'exited' | 'dead' | 'missing';
      /** Null when the container is gone and its exit code is unknown. */
      readonly exitCode: number | null;
    })
  | (CapsuleProgressBase & {
      readonly kind: 'capsule-start-failed';
      readonly stage: CapsuleStartFailureStage;
      readonly cause: CapsuleRecordedError;
    });
