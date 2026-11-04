import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import type { TestInfo } from '@playwright/test';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';

import {
  captureCapture,
  captureCatalog,
  captureEnvironment,
  type CapturedConfiguration,
} from '../../envelope/capture/configuration.js';
import { retainedEvidence } from '../../envelope/capture/evidence.js';
import { captureSource, type CapturedSource } from '../../envelope/capture/revision.js';
import type {
  CaptureConfiguration,
  EnvironmentConfiguration,
  Provenance,
  EvidenceRef,
} from '../../envelope/index.js';
import { invocationId } from './invocation.js';

/** Everything the envelope needs that must be read before the attempt changes anything. */
export interface EnvelopePrelude {
  readonly catalog: CapturedConfiguration;
  readonly source: CapturedSource;
  readonly environment: EnvironmentConfiguration;
  readonly startedAt: string;
}

function packageVersion(): string {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(`${dirname(fileURLToPath(import.meta.url))}/../../../package.json`, 'utf8'),
    );
    return typeof manifest === 'object' &&
      manifest !== null &&
      'version' in manifest &&
      typeof manifest.version === 'string'
      ? manifest.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Reads the catalog, the source tree and the environment. Returns `null` instead of throwing. */
export async function captureEnvelopePrelude(input: {
  readonly testInfo: TestInfo;
  readonly configFile: string;
  readonly entryId: string;
  readonly variables: Readonly<Record<string, string>>;
}): Promise<EnvelopePrelude | null> {
  const { testInfo } = input;
  try {
    const [catalog, source, environment] = await Promise.all([
      captureCatalog({ configFile: input.configFile, entryId: input.entryId }),
      captureSource({ directory: dirname(input.configFile), ignore: [testInfo.project.outputDir] }),
      captureEnvironment({
        playwright: testInfo.config.version,
        workers: testInfo.config.workers,
        project: testInfo.project.name,
        variables: input.variables,
      }),
    ]);
    return { catalog, source, environment, startedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

function ciEnvironment(): Record<string, string> {
  const env = process.env;
  const invocation = invocationId();
  const extra: Record<string, string> = invocation === null ? {} : { invocation };
  if (env.GITHUB_ACTIONS !== 'true') {
    return env.CI === undefined ? extra : { provider: 'unknown-ci', ...extra };
  }
  const pick = (name: string): string => env[name] ?? '';
  return {
    provider: 'github-actions',
    runId: pick('GITHUB_RUN_ID'),
    runAttempt: pick('GITHUB_RUN_ATTEMPT'),
    job: pick('GITHUB_JOB'),
    sha: pick('GITHUB_SHA'),
    ref: pick('GITHUB_REF_NAME'),
    ...extra,
  };
}

export function provenanceOf(
  testInfo: TestInfo,
  prelude: EnvelopePrelude,
  titlePath: readonly string[],
): Provenance {
  return {
    capturedAt: prelude.startedAt,
    test: {
      file: relative(testInfo.project.testDir, testInfo.file),
      titlePath,
      project: testInfo.project.name,
      runnerTestId: testInfo.testId,
    },
    source: { branch: prelude.source.branch, changedPaths: prelude.source.changedPaths },
    ci: ciEnvironment(),
    packageVersion: packageVersion(),
  };
}

/** The collector's configuration for an attempt, read from the telemetry compose file its sandbox wrote. */
export function captureAttemptCollector(sandbox: {
  readonly artifactDirectory: string;
  readonly sandboxId: string;
}): Promise<CaptureConfiguration> {
  return captureCapture(
    join(sandbox.artifactDirectory, `${sandbox.sandboxId}.compose`, 'telemetry.compose.json'),
  );
}

/** The files this attempt left under the test's output directory that its envelope's conclusions rest on. */
export function retainedAttemptFiles(
  root: string,
  sandbox: { readonly artifactDirectory: string; readonly sandboxId: string },
): Promise<EvidenceRef[]> {
  return retainedEvidence({
    root,
    sandboxRecord: `${sandbox.artifactDirectory}/${sandbox.sandboxId}.json`,
    collectorDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: sandbox.artifactDirectory,
      sandboxId: sandbox.sandboxId,
    }),
  });
}
