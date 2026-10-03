import { readCollectorSession, readCollectorTrace } from '@suites/blackbox-otel-collector';
import type { CatalogSandboxInput } from '@suites/blackbox-catalog';
import {
  sandboxTelemetryStorageDirectory,
  type SandboxHandle,
  type SandboxStopReason,
} from '@suites/blackbox-sandbox';

import type { BlackboxActivities } from '../activities/public-types.js';
import type { BlackboxEffects, BlackboxSandbox, BlackboxTelemetry } from '../types.js';

export function publicTelemetry(input: {
  readonly sandbox: SandboxHandle;
  readonly recordDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
}): BlackboxTelemetry {
  const identity = {
    sessionId: input.sessionId,
    executionId: input.executionId,
    storageDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: input.recordDirectory,
      sandboxId: input.executionId,
    }),
  };
  return Object.freeze({
    sessionId: input.sessionId,
    executionId: input.executionId,
    inspect: () => input.sandbox.inspectTelemetry(),
    read: () => readCollectorSession(identity),
    readTrace: (traceId: string) => readCollectorTrace({ ...identity, traceId }),
  });
}

export function publicAttempt(input: {
  readonly plan: CatalogSandboxInput;
  readonly sandbox: SandboxHandle;
  readonly artifactDirectory: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly createEffects: (effects: {
    readonly sessionId: string;
    readonly executionId: string;
    readonly storageDirectory: string;
    readonly entrypointUrl: string;
  }) => { readonly effects: BlackboxEffects; readonly activities: BlackboxActivities };
  readonly entrypoint: BlackboxSandbox['entrypoint'];
}) {
  const sandbox = Object.freeze({
    sandboxId: input.sandbox.sandboxId,
    executionId: input.executionId,
    catalogEntry: Object.freeze({
      id: input.plan.catalogEntryId,
      kind: input.plan.metadata.kind,
    }),
    projectName: input.sandbox.projectName,
    artifactDirectory: input.artifactDirectory,
    entrypoint: Object.freeze(input.entrypoint),
    containers: input.sandbox.containers,
  }) satisfies BlackboxSandbox;
  const telemetry = publicTelemetry({
    sandbox: input.sandbox,
    recordDirectory: input.artifactDirectory,
    sessionId: input.sessionId,
    executionId: input.executionId,
  });
  const runtime = input.createEffects({
    sessionId: input.sessionId,
    executionId: input.executionId,
    storageDirectory: sandboxTelemetryStorageDirectory({
      recordDirectory: input.artifactDirectory,
      sandboxId: input.executionId,
    }),
    entrypointUrl: input.entrypoint.url,
  });
  return {
    sandbox,
    telemetry,
    effects: runtime.effects,
    activities: runtime.activities,
    async stop(reason: SandboxStopReason): Promise<void> {
      await input.sandbox.stop({ reason });
    },
  };
}
