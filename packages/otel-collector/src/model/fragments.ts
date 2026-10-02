import type { CollectorIdentity } from './identity.js';

export interface RetainedFragment extends CollectorIdentity {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly receivedAt: string;
  readonly contentType: 'application/json';
  readonly contentEncoding: 'identity' | 'gzip';
  readonly spanCount: number;
  readonly rawJson: string;
}

export interface RetainedFragmentSummary {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly spanCount: number;
}

export interface TraceFragment {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly request: unknown;
}
