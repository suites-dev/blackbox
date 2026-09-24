import type { Readable, Writable } from 'node:stream';

import type { ClientDefinition, ClientExecutionInput, ClientResult } from '../model/client-types.js';

export interface CreateNodeClientRunnerSourceInput {
  readonly clientModuleUrl: URL;
}

export interface CreateNodeClientInspectorSourceInput {
  readonly clientModuleUrl: URL;
}

export interface RunNodeClientProcessInput {
  readonly definition: unknown;
  readonly input: Readable;
  readonly output: Writable;
}

export interface InspectNodeClientDefinitionInput {
  readonly definition: unknown;
  readonly output: Writable;
}

export type ClientProcessResult =
  | {
      readonly kind: 'completed';
      readonly metadata: ClientMetadataAvailable;
      readonly result: ClientResult;
    }
  | {
      readonly kind: 'failed';
      readonly metadata: ClientMetadataAvailability;
      readonly error: { readonly name: string; readonly message: string };
    };

export interface ClientIdentity {
  readonly kind: 'entrypoint' | 'utility';
  readonly name: string;
}

export interface ClientMetadataAvailable {
  readonly kind: 'available';
  readonly client: ClientIdentity;
}

export type ClientMetadataAvailability =
  | ClientMetadataAvailable
  | { readonly kind: 'unavailable' };

export type ClientInspectionResult =
  | {
      readonly kind: 'available';
      readonly client: ClientIdentity;
    }
  | {
      readonly kind: 'unavailable';
      readonly error: { readonly name: string; readonly message: string };
    };

export interface ExecuteClientInput {
  readonly definition: ClientDefinition;
  readonly execution: ClientExecutionInput;
}
