import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { SandboxContainerExecutionInput } from '@suites/blackbox-sandbox';
import { afterAll, expect, it } from 'vitest';

import { participantActivities, runParticipantActivity } from './participant-activity.js';

const posted: { headers: IncomingHttpHeaders; body: string }[] = [];
let collectorStatus = 200;
const collector = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
  request.on('end', () => {
    posted.push({ headers: request.headers, body });
    response.statusCode = collectorStatus;
    response.end();
  });
});
const tracesUrl = new Promise<string>((resolve) => {
  collector.listen(0, '127.0.0.1', () => {
    resolve(`http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`);
  });
});

afterAll(() => {
  collector.close();
});

const traceparent = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

function sandbox(
  result: 'exits' | 'unknown-service',
  executions: SandboxContainerExecutionInput[],
) {
  return {
    inspectTelemetry: async () => ({
      kind: 'available' as const,
      endpoints: { baseUrl: '', tracesUrl: await tracesUrl, activationUrl: '', readUrl: '' },
    }),
    async startContainerExecution(input: SandboxContainerExecutionInput) {
      executions.push(input);
      if (result === 'unknown-service') {
        return {
          kind: 'execution-failed' as const,
          failure: { kind: 'unknown-service' as const, service: input.service },
        };
      }
      await input.onOutput({ kind: 'stdout', chunk: Buffer.from('seeded ') });
      await input.onOutput({ kind: 'stderr', chunk: Buffer.from('warning') });
      await input.onOutput({ kind: 'stdout', chunk: Buffer.from('3 rows') });
      return {
        kind: 'started' as const,
        execution: {
          completion: Promise.resolve({
            kind: 'exited' as const,
            service: input.service,
            exitCode: 3,
          }),
          writeStdin: () => Promise.reject(new Error('unused')),
          endStdin: () => Promise.reject(new Error('unused')),
          resize: () => Promise.reject(new Error('unused')),
          signal: () => Promise.reject(new Error('unused')),
          forceTerminate: () => Promise.reject(new Error('unused')),
        },
      };
    },
  };
}

const activity = {
  participant: 'auth',
  argv: ['sh', '-c', 'seed --password hunter2'] as const,
  activityId: 'activity-1',
  traceparent,
};

it('runs the command in the participant with TRACEPARENT and exports its root span', async () => {
  const executions: SandboxContainerExecutionInput[] = [];
  const outcome = await runParticipantActivity({
    sandbox: sandbox('exits', executions),
    ingestToken: 'ingest-token',
    sessionId: 'session-1',
    executionId: 'execution-1',
    service: 'ts-auth-service',
    activity,
  });
  expect(executions).toMatchObject([
    {
      service: 'ts-auth-service',
      argv: activity.argv,
      environment: {
        TRACEPARENT: traceparent,
        OTEL_NODE_RESOURCE_DETECTORS: 'env,host',
      },
      stdin: 'closed',
    },
  ]);
  expect(outcome).toMatchObject({
    exitCode: 3,
    stdout: 'seeded 3 rows',
    stderr: 'warning',
    rootSpan: { kind: 'root-span-exported' },
  });
  const export_ = posted.at(-1)!;
  expect(export_.headers.authorization).toBe('Bearer ingest-token');
  const resource = JSON.parse(export_.body).resourceSpans[0];
  expect(resource.resource.attributes).toContainEqual({
    key: 'blackbox.execution.id',
    value: { stringValue: 'execution-1' },
  });
  const span = resource.scopeSpans[0].spans[0];
  // The exported root span is the parent named by TRACEPARENT, so children join it.
  expect(span).toMatchObject({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'playwright.exec',
    status: { code: 2, message: 'exit code 3' },
  });
  expect(span.attributes).toContainEqual({
    key: 'blackbox.activity.id',
    value: { stringValue: 'activity-1' },
  });
  expect(export_.body).not.toContain('hunter2');
});

it('reports a root span the collector rejected instead of claiming the link', async () => {
  collectorStatus = 401;
  try {
    const outcome = await runParticipantActivity({
      sandbox: sandbox('exits', []),
      ingestToken: 'wrong-token',
      sessionId: 'session-1',
      executionId: 'execution-1',
      service: 'ts-auth-service',
      activity,
    });
    expect(outcome.rootSpan).toEqual({
      kind: 'root-span-export-failed',
      message: 'Collector rejected the activity root span with HTTP 401',
    });
  } finally {
    collectorStatus = 200;
  }
});

it('fails when the command cannot start in the participant', async () => {
  await expect(
    runParticipantActivity({
      sandbox: sandbox('unknown-service', []),
      ingestToken: 'ingest-token',
      sessionId: 'session-1',
      executionId: 'execution-1',
      service: 'missing-service',
      activity: { ...activity, participant: 'missing' },
    }),
  ).rejects.toThrow(
    'Blackbox could not run "sh" in participant "missing" (missing-service): unknown-service',
  );
});

it('runs a catalog participant in its Compose service and refuses undeclared ones', async () => {
  const executions: SandboxContainerExecutionInput[] = [];
  const { runActivity } = participantActivities({
    sandbox: sandbox('exits', executions),
    sessionId: 'session-1',
    executionId: 'execution-1',
    authorization: { kind: 'split-bearer-tokens', ingestToken: 'ingest', controlToken: 'control' },
    plan: {
      metadata: {
        participants: {
          auth: { service: 'ts-auth-service' },
          user: { service: 'ts-user-service' },
        },
      },
    },
  });
  await runActivity({ ...activity, participant: 'user' });
  expect(executions.map(({ service }) => service)).toEqual(['ts-user-service']);
  expect(JSON.parse(posted.at(-1)!.body).resourceSpans[0].resource.attributes).toContainEqual({
    key: 'blackbox.execution.id',
    value: { stringValue: 'execution-1' },
  });
  await expect(runActivity({ ...activity, participant: 'ts-user-service' })).rejects.toThrow(
    'Blackbox participant "ts-user-service" is not declared by the catalog entry; ' +
      'declared: auth, user',
  );
  expect(executions).toHaveLength(1);
});
