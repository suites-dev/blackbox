import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import type { TestInfo } from '@playwright/test';
import { sandboxTelemetryStorageDirectory } from '@suites/blackbox-sandbox';

import type { RecordedStimuli } from '../../effects/attempt-effects.js';
import type { FinalSnapshotDocument } from '../../effects/final-snapshot.js';
import { stateSection } from '../../envelope/state.js';
import { stimulusFingerprint } from '../../stimulus/summary.js';
import { behaviorIdentity } from '../../envelope/behavior.js';
import { buildEnvelope } from '../../envelope/build.js';
import { digestBytes } from '../../envelope/canonical.js';
import {
  captureCapture,
  captureCatalog,
  captureEnvironment,
  type CapturedConfiguration,
} from '../../envelope/capture/configuration.js';
import { retainedEvidence } from '../../envelope/capture/evidence.js';
import { captureSource, type CapturedSource } from '../../envelope/capture/revision.js';
import { configurationSection } from '../../envelope/fingerprints.js';
import type {
  BehaviorEnvelope,
  EnvironmentConfiguration,
  EvidenceRef,
  Provenance,
  StimulusSection,
} from '../../envelope/types.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';
import type { AttachedEvidence } from '../attempt.js';
import { invocationId } from './invocation.js';

export const envelopeAttachment = 'blackbox-envelope';

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

function evidenceRef(item: AttachedEvidence): EvidenceRef {
  return {
    id: item.digest,
    kind: item.kind,
    bytes: item.bytes,
    locator: { type: 'attachment', name: item.name, sequence: item.sequence },
  };
}

export function stimulusSection(recorded: RecordedStimuli): StimulusSection {
  const sent = recorded.stimuli.reduce((sum, { requests }) => sum + requests.length, 0);
  return {
    state: sent === 0 && recorded.opaque === 0 ? 'none' : 'recorded',
    activities: recorded.stimuli,
    unscopedRequests: recorded.unscoped,
    opaqueRequests: recorded.opaque,
    fingerprint: stimulusFingerprint(recorded.stimuli, recorded.opaque),
  };
}

function annotationsOf(testInfo: TestInfo): { type: string; description: string }[] {
  return testInfo.annotations.map(({ type, description }) => ({
    type,
    description: description ?? '',
  }));
}

function provenanceOf(
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

export async function buildAttemptEnvelope(input: {
  readonly testInfo: TestInfo;
  readonly prelude: EnvelopePrelude;
  readonly attempt: Pick<RunningBlackboxAttempt, 'sandbox' | 'telemetry'>;
  readonly snapshot: FinalSnapshotDocument | null;
  readonly recorded: RecordedStimuli;
  readonly attached: readonly AttachedEvidence[];
}): Promise<BehaviorEnvelope> {
  const { testInfo, prelude, attempt } = input;
  const { sandbox } = attempt;
  const storage = sandboxTelemetryStorageDirectory({
    recordDirectory: sandbox.artifactDirectory,
    sandboxId: sandbox.sandboxId,
  });
  const snapshotAttachment = input.attached.find(({ kind }) => kind === 'final-snapshot');
  const files = await retainedEvidence({
    root: testInfo.outputDir,
    sandboxRecord: `${sandbox.artifactDirectory}/${sandbox.sandboxId}.json`,
    collectorDirectory: storage,
  });
  const capture = await captureCapture(
    join(sandbox.artifactDirectory, `${sandbox.sandboxId}.compose`, 'telemetry.compose.json'),
  );
  const titlePath = testInfo.titlePath.slice(1);
  return buildEnvelope({
    behavior: behaviorIdentity({
      annotations: annotationsOf(testInfo),
      catalogEntryId: prelude.catalog.system.catalogEntry.id,
      project: testInfo.project.name,
      titlePath,
    }),
    attempt: {
      attemptId: sandbox.sandboxId,
      executionId: sandbox.executionId,
      sessionId: attempt.telemetry.sessionId,
      retry: testInfo.retry,
      retries: testInfo.project.retries,
    },
    system: prelude.catalog.system,
    source: prelude.source.source,
    configuration: configurationSection({
      catalog: prelude.catalog.catalog,
      instrumentation: prelude.catalog.instrumentation,
      capture,
      environment: prelude.environment,
    }),
    snapshot: input.snapshot,
    stimulus: stimulusSection(input.recorded),
    state: stateSection(annotationsOf(testInfo)),
    snapshotEvidence: snapshotAttachment === undefined ? null : evidenceRef(snapshotAttachment),
    evidence: [...input.attached.map(evidenceRef), ...files],
    assertions: input.attached
      .filter(({ kind }) => kind === 'assertion-evidence')
      .map((item) => ({
        sequence: item.sequence,
        outcome: item.outcome,
        evaluation: item.evaluation,
        contractDigest: item.contractDigest ?? digestBytes('unknown-contract'),
        evidence: item.digest,
      })),
    testStatus: {
      status: testInfo.status ?? 'unknown',
      expectedStatus: testInfo.expectedStatus,
      errorCount: testInfo.errors.length,
    },
    provenance: provenanceOf(testInfo, prelude, titlePath),
  });
}
