import { readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import { parse } from 'yaml';

import type { SandboxProfile } from '../compiler/planning/model.js';
import type { CredentialSource } from '../runtime/credentials.js';
import type { EnvironmentSource } from '../runtime/environment.js';
import { ConfigReader, isObject, type JsonObject } from './reader.js';

/** The protected project file every `blackbox feature` command and defineGherkinConfig read. */
export const GHERKIN_CONFIG_FILE = 'blackbox.feature.yaml';

/**
 * A Gherkin project, read from blackbox.feature.yaml. Every path in the file is
 * relative to the file's directory; here they are absolute, except the globs.
 */
export interface GherkinProject {
  /** The directory of blackbox.feature.yaml. */
  readonly root: string;
  readonly configFile: string;
  readonly blackboxConfigFile: string;
  /** Accepted feature files, as globs relative to the root. */
  readonly features: readonly string[];
  /** Git-ignored directory for generated tests and the compile manifest. */
  readonly outputDir: string;
  /** Where the Blackbox reporter writes the run manifest that `verify` reads. */
  readonly runManifest: string;
  readonly policy: {
    /** The protected runner-policy baseline. */
    readonly baseline: string;
    /** Where the reporter writes the effective runner policy that `verify` compares. */
    readonly outputFile: string;
  };
  readonly sandboxProfiles: Readonly<Record<string, SandboxProfile>>;
  /** Extra path classes for `check-change`, as globs relative to the root. */
  readonly changes: { readonly spec: readonly string[]; readonly neutral: readonly string[] };
}

export class GherkinConfigError extends Error {
  readonly problems: readonly string[];

  constructor(configFile: string, problems: readonly string[]) {
    super([`${configFile} is not a valid Gherkin project file:`, ...problems.map((problem) => `  ${problem}`)].join('\n'));
    this.name = 'GherkinConfigError';
    this.problems = problems;
  }
}

const KEYS = [
  'schemaVersion',
  'blackboxConfigFile',
  'features',
  'outputDir',
  'runManifest',
  'policy',
  'sandboxes',
  'changes',
] as const;
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const CREDENTIAL_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;

// Records are built with Object.fromEntries from validated names only, never by
// assigning to a key read from the file (see ConfigReader.entries).

function environmentOf(reader: ConfigReader, value: unknown, path: string): Record<string, EnvironmentSource> {
  const entries = value === undefined ? [] : reader.entries(value, path, ENV_KEY);
  return Object.fromEntries(
    entries.map(([name, source]) => {
      const entry = reader.object(source, `${path}.${name}`, ['fromEnv']);
      return [name, { fromEnv: reader.envName(entry === null ? '' : entry.fromEnv, `${path}.${name}.fromEnv`) }];
    }),
  );
}

function credentialsOf(reader: ConfigReader, value: unknown, path: string): Record<string, CredentialSource> {
  const entries = value === undefined ? [] : reader.entries(value, path, CREDENTIAL_NAME);
  return Object.fromEntries(
    entries.map(([name, source]) => {
      const entry = reader.object(source, `${path}.${name}`, ['scheme', 'fromEnv']);
      if (entry !== null && entry.scheme !== 'bearer') {
        reader.report(`${path}.${name}.scheme`, 'must be "bearer", the only credential scheme in v1');
      }
      const fromEnv = reader.envName(entry === null ? '' : entry.fromEnv, `${path}.${name}.fromEnv`);
      return [name, { scheme: 'bearer', fromEnv } satisfies CredentialSource];
    }),
  );
}

function profilesOf(reader: ConfigReader, value: unknown): Record<string, SandboxProfile> {
  const entries = reader.entries(value, 'sandboxes', PROFILE_NAME);
  if (isObject(value) && Object.keys(value).length === 0) {
    reader.report('sandboxes', 'must define at least one Sandbox profile');
  }
  return Object.fromEntries(
    entries.map(([name, profile]) => {
      const path = `sandboxes.${name}`;
      const entry = reader.object(profile, path, ['environment', 'credentials']);
      const sandbox = {
        environment: environmentOf(reader, entry === null ? undefined : entry.environment, `${path}.environment`),
        credentials: credentialsOf(reader, entry === null ? undefined : entry.credentials, `${path}.credentials`),
      } satisfies SandboxProfile;
      return [name, sandbox];
    }),
  );
}

function insideRoot(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`);
}

function read(reader: ConfigReader, document: JsonObject, configFile: string): GherkinProject {
  const root = dirname(configFile);
  const at = (path: string) => resolve(root, path);
  if (document.schemaVersion !== 1) {
    reader.report('schemaVersion', 'must be 1');
  }
  const output = reader.relativePath(document.outputDir, 'outputDir');
  const outputDir = at(output);
  if (output !== '' && !insideRoot(root, outputDir)) {
    reader.report('outputDir', 'must be a directory inside the project directory');
  }
  const policy = reader.object(document.policy, 'policy', ['baseline', 'outputFile']);
  const changes = document.changes === undefined ? {} : reader.object(document.changes, 'changes', ['spec', 'neutral']);
  return {
    root,
    configFile,
    blackboxConfigFile: at(reader.relativePath(document.blackboxConfigFile, 'blackboxConfigFile')),
    features: reader.globs(document.features, 'features', true),
    outputDir,
    runManifest: at(reader.relativePath(document.runManifest, 'runManifest')),
    policy: {
      baseline: at(reader.relativePath(policy === null ? '' : policy.baseline, 'policy.baseline')),
      outputFile: at(reader.relativePath(policy === null ? '' : policy.outputFile, 'policy.outputFile')),
    },
    sandboxProfiles: profilesOf(reader, document.sandboxes),
    changes: {
      spec: reader.globs(changes === null ? undefined : changes.spec, 'changes.spec', false),
      neutral: reader.globs(changes === null ? undefined : changes.neutral, 'changes.neutral', false),
    },
  };
}

/** Validates a parsed blackbox.feature.yaml; throws GherkinConfigError naming every problem. */
export function parseGherkinProject(document: unknown, configFile: string): GherkinProject {
  const reader = new ConfigReader();
  const object = reader.object(document, '', KEYS);
  const project = object === null ? null : read(reader, object, resolve(configFile));
  if (project === null || reader.problems.length > 0) {
    throw new GherkinConfigError(basename(configFile), reader.problems);
  }
  return project;
}

/** Reads and validates blackbox.feature.yaml. Synchronous, because Playwright configs are. */
export function loadGherkinProject(configFile: string): GherkinProject {
  const text = readFileSync(configFile, 'utf8');
  let document: unknown;
  try {
    document = parse(text) as unknown;
  } catch (error) {
    throw new GherkinConfigError(basename(configFile), [`is not valid YAML: ${(error as Error).message}`]);
  }
  return parseGherkinProject(document, configFile);
}
