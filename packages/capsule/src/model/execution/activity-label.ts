export type CapsuleActivityPurpose = 'setup' | 'stimulus' | 'inspection';

export type CapsuleActivityName =
  { readonly kind: 'omitted' } | { readonly kind: 'provided'; readonly value: string };
