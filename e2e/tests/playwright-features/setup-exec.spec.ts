import type { TestInfo } from '@playwright/test';
import {
  expect,
  test,
  type BlackboxActivity,
  type BlackboxSandbox,
  type BlackboxTelemetry,
} from '@suites/blackbox-playwright';

import { blackboxEnvironment, readFixtureState } from '../playwright/support.js';

const credential = 'synthetic-exec-credential-must-stay-out-of-reports';
let escapedExec: BlackboxSandbox['exec'] | null = null;
const expectedIntent = {
  id: 'pi_exec-seeded-user1',
  paymentMethodId: 'pm_exec_seed',
  status: 'succeeded',
  userId: 'exec-seeded-user',
};

// Use the service's container-local address. Host-side state assertions below
// establish that this is a real setup operation against the running participant.
const seedCommand = `
  const http = require('node:http');
  const body = JSON.stringify({ userId: process.argv[1], paymentMethodId: 'pm_exec_seed' });
  const request = http.request('http://127.0.0.1:8080/v1/payment_intents', {
    method: 'POST',
    agent: false,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, (response) => {
    let data = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { data += chunk; });
    response.on('end', () => {
      process.stdout.write(JSON.stringify({
        traceparent: process.env.TRACEPARENT,
        status: response.statusCode,
        intent: JSON.parse(data),
      }) + '\\n');
      if (response.statusCode !== 201) process.exitCode = 1;
    });
  });
  request.on('error', (error) => { throw error; });
  request.end(body);
`;

interface TraceRequest {
  readonly resourceSpans: readonly {
    readonly resource: { readonly attributes: readonly Record<string, unknown>[] };
    readonly scopeSpans: readonly {
      readonly spans: readonly Record<string, unknown>[];
    }[];
  }[];
}

interface TraceLinks {
  readonly rootSpanId: string;
  readonly clientSpanId: string;
  readonly serverSpanId: string;
}

async function traceSpans(
  telemetry: BlackboxTelemetry,
  activity: BlackboxActivity,
): Promise<readonly Record<string, unknown>[]> {
  const result = await telemetry.readTrace(activity.traceId);
  expect(result.kind).toBe('collector-trace-found');
  if (result.kind !== 'collector-trace-found') {
    throw new Error(`Activity trace is unavailable: ${result.kind}`);
  }
  expect(result.identity).toEqual({
    sessionId: telemetry.sessionId,
    executionId: telemetry.executionId,
  });
  expect(JSON.stringify(result)).not.toContain(credential);
  return result.fragments.flatMap(({ request }) =>
    (request as TraceRequest).resourceSpans.flatMap(({ resource, scopeSpans }) => {
      const spans = scopeSpans.flatMap(({ spans }) => spans);
      if (spans.some((span) => span.name === 'playwright.exec')) {
        expect(resource.attributes).toEqual([
          { key: 'service.name', value: { stringValue: 'blackbox-playwright' } },
          { key: 'blackbox.session.id', value: { stringValue: telemetry.sessionId } },
          { key: 'blackbox.execution.id', value: { stringValue: telemetry.executionId } },
        ]);
      }
      return spans;
    }),
  );
}

function expectActivityRoot(
  spans: readonly Record<string, unknown>[],
  activity: BlackboxActivity,
): Record<string, unknown> {
  const roots = spans.filter((span) => span.name === 'playwright.exec');
  expect(roots).toHaveLength(1);
  const root = roots[0];
  expect(root).toMatchObject({
    traceId: activity.traceId,
    spanId: activity.traceparent.split('-')[2],
    status: activity.exitCode === 0 ? { code: 1 } : { code: 2, message: 'exit code 23' },
  });
  expect(root.attributes).toEqual([
    { key: 'blackbox.activity.id', value: { stringValue: activity.activityId } },
    { key: 'blackbox.activity.purpose', value: { stringValue: 'setup' } },
    { key: 'blackbox.participant', value: { stringValue: 'payment-mock' } },
  ]);
  return root;
}

async function expectSeedTrace(
  telemetry: BlackboxTelemetry,
  activity: BlackboxActivity,
): Promise<TraceLinks> {
  const observed: TraceLinks[] = [];
  await expect(async () => {
    const spans = await traceSpans(telemetry, activity);
    const root = expectActivityRoot(spans, activity);
    const clients = spans.filter((span) => span.kind === 3 && span.parentSpanId === root.spanId);
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ traceId: activity.traceId, name: 'POST' });
    expect(clients[0].attributes).toContainEqual({
      key: 'url.full',
      value: { stringValue: 'http://127.0.0.1:8080/v1/payment_intents' },
    });
    const servers = spans.filter(
      (span) => span.kind === 2 && span.parentSpanId === clients[0].spanId,
    );
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ traceId: activity.traceId, name: 'POST' });
    expect(clients[0].spanId).toMatch(/^[a-f0-9]{16}$/u);
    expect(servers[0].spanId).toMatch(/^[a-f0-9]{16}$/u);
    observed.push({
      rootSpanId: String(root.spanId),
      clientSpanId: String(clients[0].spanId),
      serverSpanId: String(servers[0].spanId),
    });
  }).toPass({ timeout: 15_000 });
  expect(observed).toHaveLength(1);
  return observed[0];
}

async function attachReceipt(
  sandbox: BlackboxSandbox,
  telemetry: BlackboxTelemetry,
  testInfo: TestInfo,
  evidence: { readonly activities: readonly BlackboxActivity[]; readonly traceLinks: TraceLinks },
): Promise<void> {
  await testInfo.attach('blackbox-feature-receipt:setup-exec', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        sandboxId: sandbox.sandboxId,
        executionId: sandbox.executionId,
        sessionId: telemetry.sessionId,
        artifactDirectory: sandbox.artifactDirectory,
        outputDirectory: testInfo.outputPath(),
        secret: credential,
        traceLinks: evidence.traceLinks,
        activities: evidence.activities.map(({ activityId, traceId, traceparent, exitCode }) => ({
          activityId,
          traceId,
          traceparent,
          exitCode,
          rootSpanId: traceparent.split('-')[2],
        })),
      },
      null,
      2,
    ),
  });
}

test.system({ kind: 'subsystem', id: 'payment-mock' }, (system) => {
  system.sandbox('setup activities', { environment: blackboxEnvironment }, (sandbox) => {
    sandbox.test(
      'Scenario: container setup seeds state and produces linked activity evidence',
      async ({ sandbox, request, telemetry }, testInfo) => {
        escapedExec = sandbox.exec.bind(sandbox);
        expect(await readFixtureState(request, sandbox.entrypoint.url)).toEqual({
          paymentIntents: [],
          refunds: [],
        });

        const seeded = await test.step('Run a setup command inside the payment participant', () =>
          sandbox.exec('payment-mock', [
            'node',
            '-e',
            seedCommand,
            '--',
            'exec-seeded-user',
            `--password=${credential}`,
          ]));
        expect(seeded).toMatchObject({
          participant: 'payment-mock',
          purpose: 'setup',
          exitCode: 0,
          rootSpan: { kind: 'root-span-exported' },
        });
        expect(seeded.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/u);
        expect(JSON.parse(seeded.stdout)).toEqual({
          traceparent: seeded.traceparent,
          status: 201,
          intent: expectedIntent,
        });
        expect(await readFixtureState(request, sandbox.entrypoint.url)).toEqual({
          paymentIntents: [expectedIntent],
          refunds: [],
        });
        const traceLinks = await expectSeedTrace(telemetry, seeded);

        const failed = await test.step('Preserve an unsuccessful command outcome', () =>
          sandbox.exec('payment-mock', [
            'node',
            '-e',
            'process.stderr.write("intentional setup failure\\n"); process.exitCode = 23;',
          ]));
        expect(failed.exitCode).toBe(23);
        expect(failed.stderr).toContain('intentional setup failure');
        expect(failed.rootSpan).toEqual({ kind: 'root-span-exported' });
        expect(failed.activityId).not.toBe(seeded.activityId);
        expect(failed.traceId).not.toBe(seeded.traceId);
        expectActivityRoot(await traceSpans(telemetry, failed), failed);

        await expect(
          sandbox.exec('undeclared-participant', ['node', '-e', 'process.exit(0)']),
        ).rejects.toThrow(
          'Blackbox participant "undeclared-participant" is not declared by the catalog entry',
        );

        await attachReceipt(sandbox, telemetry, testInfo, {
          activities: [seeded, failed],
          traceLinks,
        });
      },
    );
  });
});

test.afterAll('Expired setup handles reject after attempt teardown', async () => {
  expect(escapedExec).not.toBeNull();
  if (escapedExec === null) {
    throw new Error('The setup activity test did not acquire a sandbox exec handle');
  }
  await expect(escapedExec('payment-mock', ['node', '-e', 'process.exit(0)'])).rejects.toThrow(
    'This Blackbox attempt has expired. Activity execution is no longer available.',
  );
});
