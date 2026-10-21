import { isSecretEnvironmentName } from '../reporting/redaction/secret-environment.js';
import { digestOf, type Digest } from './canonical.js';
import type {
  CaptureConfiguration,
  CatalogConfiguration,
  ConfigurationSection,
  EnvironmentConfiguration,
  InputDigest,
  InstrumentationConfiguration,
  SourceSection,
  WorkingTree,
} from './types.js';

const byPath = (left: InputDigest, right: InputDigest): number =>
  `${left.role}:${left.path}` < `${right.role}:${right.path}` ? -1 : 1;

export function catalogDigest(value: Omit<CatalogConfiguration, 'digest'>): Digest {
  return digestOf({ entryId: value.entryId, resolved: value.resolved, inputs: value.inputs });
}

export function catalogConfiguration(input: {
  readonly entryId: string;
  /** The resolved catalog entry as plain data, without absolute paths. */
  readonly resolved: unknown;
  readonly inputs: readonly InputDigest[];
}): CatalogConfiguration {
  const partial = {
    entryId: input.entryId,
    resolved: digestOf(input.resolved),
    inputs: [...input.inputs].sort(byPath),
  };
  return { ...partial, digest: catalogDigest(partial) };
}

export function instrumentationDigest(value: Omit<InstrumentationConfiguration, 'digest'>): Digest {
  return digestOf({ activations: value.activations, inputs: value.inputs });
}

export function instrumentationConfiguration(input: {
  readonly activations: InstrumentationConfiguration['activations'];
  readonly inputs: readonly InputDigest[];
}): InstrumentationConfiguration {
  const partial = {
    activations: [...input.activations].sort((left, right) => (left.id < right.id ? -1 : 1)),
    inputs: [...input.inputs].sort(byPath),
  };
  return { ...partial, digest: instrumentationDigest(partial) };
}

export function captureDigest(value: object): Digest {
  return digestOf(value);
}

export function captureConfiguration(
  input: Omit<CaptureConfiguration, 'digest'>,
): CaptureConfiguration {
  return { ...input, digest: captureDigest(input) };
}

export function environmentDigest(value: Omit<EnvironmentConfiguration, 'digest'>): Digest {
  return digestOf(value);
}

/** Credential-named variables contribute their names only; every other value is reduced to a digest. */
export function environmentConfiguration(input: {
  readonly platform: string;
  readonly arch: string;
  readonly node: string;
  readonly docker: string;
  readonly playwright: string;
  readonly workers: number;
  readonly project: string;
  readonly variables: Readonly<Record<string, string>>;
}): EnvironmentConfiguration {
  const names = Object.keys(input.variables).sort();
  const variables = Object.fromEntries(
    names
      .filter((name) => !isSecretEnvironmentName(name))
      .map((name) => [name, digestOf({ name, value: input.variables[name] })]),
  );
  const { variables: _raw, ...rest } = input;
  const partial = {
    ...rest,
    variables,
    secretVariableNames: names.filter((name) => isSecretEnvironmentName(name)),
  };
  return { ...partial, digest: environmentDigest(partial) };
}

export function configurationFingerprint(parts: {
  readonly catalog: { readonly digest: Digest };
  readonly instrumentation: { readonly digest: Digest };
  readonly capture: { readonly digest: Digest };
  readonly environment: { readonly digest: Digest };
}): Digest {
  return digestOf({
    catalog: parts.catalog.digest,
    instrumentation: parts.instrumentation.digest,
    capture: parts.capture.digest,
    environment: parts.environment.digest,
  });
}

export function configurationSection(
  parts: Pick<ConfigurationSection, 'catalog' | 'instrumentation' | 'capture' | 'environment'>,
): ConfigurationSection {
  return { ...parts, fingerprint: configurationFingerprint(parts) };
}

export function sourceFingerprint(input: {
  readonly repoId: string | null;
  readonly commit: string | null;
  readonly tree: string | null;
  readonly workingTree: WorkingTree;
}): Digest | null {
  if (input.repoId === null || input.commit === null || input.workingTree.state === 'unknown') {
    return null;
  }
  return digestOf({
    repoId: input.repoId,
    commit: input.commit,
    tree: input.tree,
    workingTree:
      input.workingTree.state === 'clean'
        ? { state: 'clean' }
        : {
            state: 'dirty',
            digest: input.workingTree.digest,
            coverage: input.workingTree.coverage,
          },
  });
}

export function unavailableSource(reason: string): SourceSection {
  return {
    state: 'unavailable',
    repoId: null,
    commit: null,
    tree: null,
    workingTree: { state: 'unknown', reason },
    fingerprint: null,
    reason,
  };
}
