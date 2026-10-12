/** The source owns a fixed, trusted activity selection and raw-span admission. */
export type EffectObservationReadResult =
  | {
      readonly kind: 'admitted';
      readonly scopeId: string;
      readonly payloads: readonly unknown[];
      readonly diagnostics: readonly string[];
    }
  | { readonly kind: 'unavailable' | 'rejected'; readonly message: string };

export interface EffectObservationSource {
  read(): Promise<EffectObservationReadResult>;
}
