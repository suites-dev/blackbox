import type { CollectorHttpInput } from './endpoint.js';
import type { CollectorIdentity } from './identity.js';

export interface CollectorAuthorization {
  readonly kind: 'split-bearer-tokens';
  readonly ingestToken: string;
  readonly controlToken: string;
}

export interface CollectorLimits {
  readonly maxRequestBytes: number;
  readonly maxRetainedBytes: number;
  readonly maxRetainedFragments: number;
  readonly shutdownTimeoutMs: number;
}

export interface StartCollectorInput extends CollectorIdentity {
  readonly kind: 'start-collector';
  readonly storageDirectory: string;
  readonly endpoint: CollectorHttpInput;
  readonly authorization: CollectorAuthorization;
  readonly limits: CollectorLimits;
}
