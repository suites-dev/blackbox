import type { SandboxHandle } from '@suites/blackbox-sandbox';

import type { TelemetryAuthorization } from '../runtime/telemetry.js';

type ActivitySandbox = Pick<SandboxHandle, 'startContainerExecution' | 'inspectTelemetry'>;

/** One setup command, already given its activity identity and trace context. */
export interface ParticipantActivityInput {
  readonly participant: string;
  readonly argv: readonly [string, ...string[]];
  readonly activityId: string;
  readonly traceparent: string;
}

export type ActivityRootSpan =
  | { readonly kind: 'root-span-exported' }
  | { readonly kind: 'root-span-export-failed'; readonly message: string };

export interface ParticipantActivityOutcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly rootSpan: ActivityRootSpan;
}

const outputLimitBytes = 1024 * 1024;

function nanos(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

/** Same root-span shape as `capsule run`, so readers join activities the same way. */
function rootSpanRequest(input: {
  readonly sessionId: string;
  readonly executionId: string;
  readonly activity: ParticipantActivityInput;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exitCode: number;
}): object {
  const [, traceId, spanId] = input.activity.traceparent.split('-');
  const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attribute('service.name', 'blackbox-playwright'),
            attribute('blackbox.session.id', input.sessionId),
            attribute('blackbox.execution.id', input.executionId),
          ],
        },
        scopeSpans: [
          {
            scope: { name: '@suites/blackbox-playwright', version: '1' },
            spans: [
              {
                traceId,
                spanId,
                name: 'playwright.exec',
                kind: 1,
                startTimeUnixNano: nanos(input.startedAt),
                endTimeUnixNano: nanos(input.completedAt),
                attributes: [
                  attribute('blackbox.activity.id', input.activity.activityId),
                  attribute('blackbox.activity.purpose', 'setup'),
                  attribute('blackbox.participant', input.activity.participant),
                ],
                status:
                  input.exitCode === 0
                    ? { code: 1 }
                    : { code: 2, message: `exit code ${input.exitCode}` },
              },
            ],
          },
        ],
      },
    ],
  };
}

async function exportRootSpan(input: {
  readonly sandbox: ActivitySandbox;
  readonly ingestToken: string;
  readonly body: object;
}): Promise<ActivityRootSpan> {
  try {
    const telemetry = await input.sandbox.inspectTelemetry();
    if (telemetry.kind !== 'available') {
      return { kind: 'root-span-export-failed', message: `Collector is ${telemetry.kind}` };
    }
    const response = await fetch(telemetry.endpoints.tracesUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(5_000),
      headers: {
        authorization: `Bearer ${input.ingestToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.body),
    });
    return response.ok
      ? { kind: 'root-span-exported' }
      : {
          kind: 'root-span-export-failed',
          message: `Collector rejected the activity root span with HTTP ${response.status}`,
        };
  } catch (error) {
    return {
      kind: 'root-span-export-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function collector(): {
  readonly append: (chunk: Uint8Array) => void;
  readonly text: () => string;
} {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    append(chunk) {
      if (size < outputLimitBytes) {
        const kept = Buffer.from(chunk).subarray(0, outputLimitBytes - size);
        chunks.push(kept);
        size += kept.length;
      }
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

export type ParticipantActivityRunner = (
  activity: ParticipantActivityInput,
) => Promise<ParticipantActivityOutcome>;

/**
 * The attempt's activity runner. Participants are named as in the catalog entry and
 * run in their Compose service; root spans authenticate with the ingest token.
 */
export function participantActivities(input: {
  readonly sandbox: ActivitySandbox;
  readonly sessionId: string;
  readonly executionId: string;
  readonly authorization: TelemetryAuthorization;
  readonly plan: {
    readonly metadata: {
      readonly participants: Readonly<Record<string, { readonly service: string }>>;
    };
  };
}): { readonly runActivity: ParticipantActivityRunner } {
  const participants = input.plan.metadata.participants;
  return {
    runActivity: async (activity) => {
      if (!Object.hasOwn(participants, activity.participant)) {
        throw new Error(
          `Blackbox participant ${JSON.stringify(activity.participant)} is not declared by the ` +
            `catalog entry; declared: ${Object.keys(participants).sort().join(', ')}`,
        );
      }
      return runParticipantActivity({
        sandbox: input.sandbox,
        ingestToken: input.authorization.ingestToken,
        sessionId: input.sessionId,
        executionId: input.executionId,
        service: participants[activity.participant].service,
        activity,
      });
    },
  };
}

/**
 * Run a command in a participant container with the activity's TRACEPARENT, then
 * export the activity root span that instrumented children of the command join.
 */
export async function runParticipantActivity(input: {
  readonly sandbox: ActivitySandbox;
  readonly ingestToken: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly service: string;
  readonly activity: ParticipantActivityInput;
}): Promise<ParticipantActivityOutcome> {
  const stdout = collector();
  const stderr = collector();
  const startedAt = new Date().toISOString();
  const started = await input.sandbox.startContainerExecution({
    kind: 'container-stream-exec',
    service: input.service,
    argv: input.activity.argv,
    environment: {
      TRACEPARENT: input.activity.traceparent,
      // Node's process detector exports argv, which can contain setup credentials.
      OTEL_NODE_RESOURCE_DETECTORS: 'env,host',
    },
    terminal: { kind: 'captured' },
    stdin: 'closed',
    onOutput: (event) => {
      (event.kind === 'stderr' ? stderr : stdout).append(event.chunk);
      return Promise.resolve();
    },
  });
  const outcome = started.kind === 'started' ? await started.execution.completion : started;
  if (outcome.kind !== 'exited') {
    throw new Error(
      `Blackbox could not run ${JSON.stringify(input.activity.argv[0])} in participant ` +
        `${JSON.stringify(input.activity.participant)} (${input.service}): ${outcome.failure.kind}`,
    );
  }
  const completedAt = new Date().toISOString();
  const rootSpan = await exportRootSpan({
    sandbox: input.sandbox,
    ingestToken: input.ingestToken,
    body: rootSpanRequest({
      sessionId: input.sessionId,
      executionId: input.executionId,
      activity: input.activity,
      startedAt,
      completedAt,
      exitCode: outcome.exitCode,
    }),
  });
  return {
    exitCode: outcome.exitCode,
    stdout: stdout.text(),
    stderr: stderr.text(),
    startedAt,
    completedAt,
    rootSpan,
  };
}
