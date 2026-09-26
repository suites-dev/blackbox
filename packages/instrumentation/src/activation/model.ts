export type RuntimeActivationValuePart =
  | {
      readonly kind: 'activation-asset-path';
      readonly prefix: string;
    }
  | {
      readonly kind: 'mounted-relative-path';
      readonly prefix: string;
      readonly relativePath: string;
    };

export interface RuntimeActivationEnvironmentAppend {
  readonly kind: 'append-environment-variable';
  readonly name: string;
  readonly separator: string;
  readonly value: readonly RuntimeActivationValuePart[];
}

export interface RuntimeActivationAdapter {
  readonly kind: 'runtime-activation-adapter';
  readonly runtime: string;
  readonly adapter: string;
  readonly sourceDirectoryRelativePath: string;
  readonly targetDirectory: string;
  readonly environment: RuntimeActivationEnvironmentAppend;
}
