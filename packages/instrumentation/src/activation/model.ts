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


/** Why a participant cannot start: no installed adapter loads its activation for its runtime. */
export function unavailableRuntimeActivationAdapterMessage(input: {
  readonly runtime: string;
  readonly adapter: string;
}): string {
  return `Activation adapter ${JSON.stringify(input.adapter)} for runtime ${JSON.stringify(input.runtime)} is unavailable`;
}

export function isRuntimeActivationAdapter(value: unknown): value is RuntimeActivationAdapter {
  if (typeof value !== 'object' || value === null) {return false;}
  const record = value as Record<string, unknown>;
  return record.kind === 'runtime-activation-adapter'
    && typeof record.runtime === 'string'
    && typeof record.adapter === 'string'
    && typeof record.sourceDirectoryRelativePath === 'string'
    && typeof record.targetDirectory === 'string'
    && typeof record.environment === 'object'
    && record.environment !== null;
}
