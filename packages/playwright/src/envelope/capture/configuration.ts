import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  loadCatalogFile,
  resolveCatalogEntry,
  type CatalogSandboxInput,
} from '@suites/blackbox-catalog';

import { activityAdmissionLimits } from '../../activities/limits.js';
import { evidenceLimits } from '../../effects/evaluation/artifact.js';
import { infrastructureProfile } from '../../effects/evaluation/observation-artifact.js';
import { digestBytes, type Digest } from '../canonical.js';
import {
  captureConfiguration,
  catalogConfiguration,
  environmentConfiguration,
  instrumentationConfiguration,
} from '../fingerprints.js';
import type {
  CaptureConfiguration,
  CatalogConfiguration,
  EnvironmentConfiguration,
  InputDigest,
  InstrumentationConfiguration,
  SystemSection,
} from '../types.js';

const run = promisify(execFile);

async function readContained(
  root: string,
  path: string,
): Promise<{ readonly state: InputDigest['state']; readonly digest: Digest | null }> {
  const target = resolve(root, path);
  try {
    const [real, base] = await Promise.all([realpath(target), realpath(root)]);
    const inside = relative(base, real);
    if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside)) {
      return { state: 'unreadable', digest: null };
    }
    return { state: 'present', digest: digestBytes(await readFile(real)) };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    return { state: code === 'ENOENT' ? 'missing' : 'unreadable', digest: null };
  }
}

async function inputs(
  root: string,
  entries: readonly { readonly role: InputDigest['role']; readonly path: string }[],
): Promise<InputDigest[]> {
  const unique = [
    ...new Map(entries.map((entry) => [`${entry.role}:${entry.path}`, entry])).values(),
  ];
  return Promise.all(
    unique.map(async (entry) => ({ ...entry, ...(await readContained(root, entry.path)) })),
  );
}

function systemOf(plan: CatalogSandboxInput): SystemSection {
  const { metadata } = plan;
  return {
    catalogEntry: { id: plan.catalogEntryId, kind: metadata.kind },
    participants: Object.entries(metadata.participants)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([id, participant]) => ({
        id,
        service: participant.service,
        role: participant.role,
        runtime: participant.runtime,
        instrumentation:
          participant.activation.kind === 'configured' ? 'configured' : 'unconfigured',
        activationId:
          participant.activation.kind === 'configured' ? participant.activation.activationId : null,
      })),
    observationPolicy: {
      policyId: metadata.observation.policyId,
      requiredBoundaries: [...metadata.observation.requiredBoundaries].sort(),
    },
  };
}

export interface CapturedConfiguration {
  readonly system: SystemSection;
  readonly catalog: CatalogConfiguration;
  readonly instrumentation: InstrumentationConfiguration;
}

/**
 * The effective configuration of the selected entry: the resolved catalog entry plus the bytes of every file
 * it references. Editing a Compose file, a driver or an activation changes a digest even when no commit does.
 */
export async function captureCatalog(input: {
  readonly configFile: string;
  readonly entryId: string;
}): Promise<CapturedConfiguration> {
  const catalog = await loadCatalogFile({ configFile: input.configFile });
  const plan = resolveCatalogEntry({
    catalog,
    selection: { kind: 'explicit-entry', entryId: input.entryId },
  });
  const { projectDirectory: root, ...resolved } = plan;
  const activations = Object.entries(plan.metadata.activations);
  const manifestFiles = activations.flatMap(([, activation]) => {
    const directory = dirname(activation.ref);
    return ['package.json', 'package-lock.json', 'pnpm-lock.yaml'].map((name) => ({
      role: 'instrumentation-manifest' as const,
      path: resolve('/', directory, name).slice(1),
    }));
  });
  return {
    system: systemOf(plan),
    catalog: catalogConfiguration({
      entryId: plan.catalogEntryId,
      resolved,
      inputs: await inputs(root, [
        ...plan.composeFiles.map((path) => ({ role: 'compose' as const, path })),
        ...Object.values(plan.drivers).map(({ ref }) => ({ role: 'driver' as const, path: ref })),
      ]),
    }),
    instrumentation: instrumentationConfiguration({
      activations: activations.map(([id, activation]) => ({
        id,
        adapter: activation.adapter,
        version: activation.version,
      })),
      inputs: (
        await inputs(root, [
          ...activations.map(([, activation]) => ({
            role: 'activation' as const,
            path: activation.ref,
          })),
          ...manifestFiles,
        ])
      ).filter((entry) => entry.role === 'activation' || entry.state === 'present'),
    }),
  };
}

let dockerVersion: Promise<string> | undefined;

function docker(): Promise<string> {
  dockerVersion ??= run('docker', ['version', '--format', '{{.Server.Version}}'], {
    timeout: 5000,
    encoding: 'utf8',
  })
    .then(({ stdout }) => stdout.trim() || 'unknown')
    .catch(() => 'unknown');
  return dockerVersion;
}

export async function captureEnvironment(input: {
  readonly playwright: string;
  readonly workers: number;
  readonly project: string;
  readonly variables: Readonly<Record<string, string>>;
}): Promise<EnvironmentConfiguration> {
  return environmentConfiguration({
    platform: platform(),
    arch: arch(),
    node: process.version,
    docker: await docker(),
    playwright: input.playwright,
    workers: input.workers,
    project: input.project,
    variables: input.variables,
  });
}

const collectorLimitNames = [
  'BLACKBOX_OTEL_MAX_REQUEST_BYTES',
  'BLACKBOX_OTEL_MAX_RETAINED_BYTES',
  'BLACKBOX_OTEL_MAX_RETAINED_FRAGMENTS',
  'BLACKBOX_OTEL_SHUTDOWN_TIMEOUT_MS',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The collector as it was configured for this attempt, without its ids, tokens, ports or host paths. */
export async function captureCapture(telemetryComposeFile: string): Promise<CaptureConfiguration> {
  let image: string | null = null;
  const limits: Record<string, string> = {};
  let state: CaptureConfiguration['state'] = 'collector-config-unavailable';
  try {
    const parsed: unknown = JSON.parse(await readFile(telemetryComposeFile, 'utf8'));
    const services = isRecord(parsed) && isRecord(parsed.services) ? parsed.services : {};
    const collector = services['blackbox-otel-collector'];
    if (isRecord(collector)) {
      image = typeof collector.image === 'string' ? collector.image : null;
      const environment = isRecord(collector.environment) ? collector.environment : {};
      for (const name of collectorLimitNames) {
        const value = environment[name];
        if (typeof value === 'string') {
          limits[name] = value;
        }
      }
      state = 'captured';
    }
  } catch {
    state = 'collector-config-unavailable';
  }
  return captureConfiguration({
    collector: { image, limits },
    snapshot: { schemaVersion: 1, selection: 'completed-stimulus-activities' },
    noiseProfile: infrastructureProfile,
    schemas: { effectsGraph: '0.1.1', effectsRecord: 0 },
    admission: { ...activityAdmissionLimits },
    evidenceLimits: { ...evidenceLimits },
    state,
  });
}
