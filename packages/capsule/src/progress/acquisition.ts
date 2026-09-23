import type { ComposeAcquisitionObservation, ComposeServiceObservation } from '@suites/blackbox-sandbox-internal';

export type CapsuleAcquisitionObservation =
  | Exclude<ComposeAcquisitionObservation, { readonly kind: 'service-state' }>
  | { readonly kind: 'service-state'; readonly participant: string; readonly container: ComposeServiceObservation };
