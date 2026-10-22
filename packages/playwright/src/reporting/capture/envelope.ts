import type { TestInfo } from '@playwright/test';

import type { RecordedStimuli } from '../../effects/attempt-effects.js';
import type { FinalSnapshotDocument } from '../../effects/final-snapshot.js';
import { stateSection } from '../../envelope/state.js';
import { stimulusFingerprint } from '../../stimulus/summary.js';
import { behaviorIdentity } from '../../envelope/behavior.js';
import { buildEnvelope } from '../../envelope/build.js';
import {
  digestBytes,
  type BehaviorEnvelope,
  type EvidenceRef,
  type StimulusSection,
} from '../../envelope/index.js';
import { configurationSection } from '../../envelope/fingerprints.js';
import type { RunningBlackboxAttempt } from '../../runtime/acquisition.js';
import type { AttachedEvidence } from '../attempt.js';
import {
  captureAttemptCollector,
  provenanceOf,
  retainedAttemptFiles,
  type EnvelopePrelude,
} from './prelude.js';

export const envelopeAttachment = 'blackbox-envelope';

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
    state: sent === 0 && recorded.opaque === 0 && recorded.unscoped === 0 ? 'none' : 'recorded',
    activities: recorded.stimuli,
    unscopedRequests: recorded.unscoped,
    opaqueRequests: recorded.opaque,
    fingerprint: stimulusFingerprint(recorded.stimuli, recorded.opaque + recorded.unscoped),
  };
}

function annotationsOf(testInfo: TestInfo): { type: string; description: string }[] {
  return testInfo.annotations.map(({ type, description }) => ({
    type,
    description: description ?? '',
  }));
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
  const snapshotAttachment = input.attached.find(({ kind }) => kind === 'final-snapshot');
  const files = await retainedAttemptFiles(testInfo.outputDir, sandbox);
  const capture = await captureAttemptCollector(sandbox);
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
