import type { CollectorIdentity } from '../../model/types.js';

export interface LinuxProcessOwner {
  readonly kind: 'linux-process-instance';
  readonly pid: number;
  readonly pidNamespace: string;
  readonly bootId: string;
  readonly startTimeTicks: string;
}

export interface PidOnlyProcessOwner {
  readonly kind: 'pid-only-process';
  readonly pid: number;
}

export type ProcessOwner = LinuxProcessOwner | PidOnlyProcessOwner;

export type ProcessInspection =
  | { readonly kind: 'process-instance-observed'; readonly owner: LinuxProcessOwner }
  | { readonly kind: 'process-alive-unidentified'; readonly pid: number }
  | { readonly kind: 'process-inspection-unavailable'; readonly pid: number }
  | { readonly kind: 'process-missing'; readonly pid: number };

export interface LeaseRuntime {
  readonly currentOwner: ProcessOwner;
  readonly inspectProcess: (input: { readonly pid: number }) => Promise<ProcessInspection>;
  readonly createToken: () => string;
  readonly now: () => string;
  readonly nowMilliseconds: () => number;
  readonly heartbeatIntervalMs: number;
  readonly staleAfterMs: number;
}

export interface CollectorStorageLease extends CollectorIdentity {
  readonly storageDirectory: string;
  readonly token: string;
  readonly assertOwned: () => Promise<void>;
  readonly release: () => Promise<void>;
}

export interface StorageLeaseInput extends CollectorIdentity {
  readonly storageDirectory: string;
}
