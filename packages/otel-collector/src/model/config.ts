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
  /** Explicit protected values for redaction before fragment storage; omitted preserves legacy behavior. */
  // eslint-disable-next-line no-restricted-syntax -- omission preserves the legacy collector API
  readonly redaction?: { readonly kind: 'credentials-v1'; readonly secrets: readonly string[] };
}
