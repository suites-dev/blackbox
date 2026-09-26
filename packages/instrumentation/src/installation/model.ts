export interface RuntimeInstrumentationFile {
  readonly kind: 'runtime-instrumentation-file';
  readonly name: string;
  readonly content: string;
}

export interface RuntimeActivationInstruction {
  readonly kind: 'runtime-activation-instruction';
  readonly description: string;
  readonly command: string;
}

export interface RuntimePreparationSuccess {
  readonly kind: 'runtime-preparation-success';
  readonly action: 'installed' | 'unchanged';
}

export interface RuntimePreparationFailure {
  readonly kind: 'runtime-preparation-failure';
  readonly message: string;
}

export type RuntimePreparationResult = RuntimePreparationSuccess | RuntimePreparationFailure;

export interface RuntimePreparationInput {
  readonly directory: string;
}

export interface RuntimeInstrumentationProvider {
  readonly kind: 'runtime-instrumentation-provider';
  readonly runtime: string;
  readonly displayName: string;
  readonly files: readonly RuntimeInstrumentationFile[];
  readonly activation: readonly RuntimeActivationInstruction[];
  readonly prepare: (input: RuntimePreparationInput) => Promise<RuntimePreparationResult>;
}

export interface InstallInstrumentationInput {
  readonly projectDirectory: string;
  readonly runtime: string;
  readonly providers: readonly RuntimeInstrumentationProvider[];
}

export interface InstalledInstrumentationFile {
  readonly kind: 'instrumentation-file';
  readonly path: string;
}

export interface InstrumentationInstallSuccess {
  readonly kind: 'instrumentation-install-success';
  readonly ok: true;
  readonly runtime: string;
  readonly runtimeDisplayName: string;
  readonly directory: string;
  readonly files: readonly InstalledInstrumentationFile[];
  readonly activation: readonly RuntimeActivationInstruction[];
  readonly fileAction: 'created' | 'unchanged';
  readonly dependencyAction: 'installed' | 'unchanged';
}

export interface UnsupportedInstrumentationRuntimeFailure {
  readonly kind: 'unsupported-instrumentation-runtime';
  readonly ok: false;
  readonly runtime: string;
  readonly message: string;
}

export interface InstrumentationConflictFailure {
  readonly kind: 'instrumentation-install-conflict';
  readonly ok: false;
  readonly runtime: string;
  readonly paths: readonly string[];
  readonly message: string;
}

export interface InstrumentationInstallBusyFailure {
  readonly kind: 'instrumentation-install-busy';
  readonly ok: false;
  readonly runtime: string;
  readonly directory: string;
  readonly message: string;
}

export interface InstrumentationInstallOperationalFailure {
  readonly kind: 'instrumentation-install-operational-error';
  readonly ok: false;
  readonly runtime: string;
  readonly directory: string;
  readonly message: string;
}

export type InstrumentationInstallFailure =
  | UnsupportedInstrumentationRuntimeFailure
  | InstrumentationConflictFailure
  | InstrumentationInstallBusyFailure
  | InstrumentationInstallOperationalFailure;

export type InstrumentationInstallResult =
  | InstrumentationInstallSuccess
  | InstrumentationInstallFailure;
