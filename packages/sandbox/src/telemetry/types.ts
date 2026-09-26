export type SandboxTelemetryActivation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'append-environment-variable';
      readonly name: string;
      readonly value: string;
    };
