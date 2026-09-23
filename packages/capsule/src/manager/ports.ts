import {
  loadCatalogFile,
  resolveCatalogEntry,
  type CatalogSandboxInput,
  type LoadedCatalog,
} from '@suites/blackbox-catalog-internal';
import {
  composeProjectName,
  startSandbox,
  type SandboxHandle,
  type SandboxStartInput,
} from '@suites/blackbox-sandbox-internal';

export interface CapsuleCatalogPort {
  load(input: { readonly configFile: string }): Promise<LoadedCatalog>;
  resolve(input: {
    readonly catalog: LoadedCatalog;
    readonly systemId: string;
  }): CatalogSandboxInput;
}

export interface CapsuleSandboxPort {
  projectName(input: { readonly sandboxId: string }): string;
  start(input: SandboxStartInput): Promise<SandboxHandle>;
}

export interface CapsuleManagerPorts {
  readonly catalog: CapsuleCatalogPort;
  readonly sandbox: CapsuleSandboxPort;
  readonly now: () => Date;
}

export const nodeCapsuleManagerPorts = {
  catalog: {
    load: (input) => loadCatalogFile(input),
    resolve: ({ catalog, systemId }) =>
      resolveCatalogEntry({ catalog, selection: { kind: 'explicit-entry', entryId: systemId } }),
  },
  sandbox: {
    projectName: (input) => composeProjectName(input),
    start: (input) => startSandbox(input),
  },
  now: () => new Date(),
} satisfies CapsuleManagerPorts;
