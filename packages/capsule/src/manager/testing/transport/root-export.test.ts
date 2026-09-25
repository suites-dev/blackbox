import { once } from 'node:events';
import { createServer } from 'node:http';

import { expect, it } from 'vitest';

import { managerRequest } from '../../../ipc/client.js';
import { readCapsuleActivities } from '../../../records.js';
import { requestFixture } from '../request.fixture.js';

async function collector(fault: 'http-rejection' | 'transport-failure') {
  const observed: { body: string; authorization: string }[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
    request.on('end', () => {
      observed.push({ body, authorization: request.headers.authorization ?? '' });
      if (fault === 'transport-failure') {
        request.socket.destroy();
      } else {
        response.writeHead(503).end('private-collector-diagnostic');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected collector TCP endpoint');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { observed,
    telemetry: { kind: 'available' as const, endpoints: { baseUrl,
      tracesUrl: `${baseUrl}/v1/traces`, activationUrl: `${baseUrl}/activation`,
      readUrl: `${baseUrl}/status` } },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => { if (error) { reject(error); } else { resolve(); } });
      });
    },
  };
}

it.each([
  { fault: 'http-rejection', exitCode: 0 }, { fault: 'http-rejection', exitCode: 7 },
  { fault: 'transport-failure', exitCode: 0 }, { fault: 'transport-failure', exitCode: 7 },
] as const)('retains exit $exitCode and explicit failed telemetry after root-span $fault', async ({ fault, exitCode }) => {
  const receiver = await collector(fault);
  const fixture = await requestFixture(() => Promise.resolve());
  Object.assign(fixture.manager.sandbox, {
    inspectTelemetry: () => Promise.resolve(receiver.telemetry),
  });
  try {
    const response = await managerRequest({ socketPath: fixture.socketPath, request: {
      kind: 'exec-request', requestId: 'root-failure', purpose: 'stimulus',
      target: { kind: 'host', argv: [process.execPath, '-e',
        `process.stdout.write('retained-output'); process.stderr.write('retained-error'); process.exitCode = ${exitCode};`] },
    } });
    expect(response).toMatchObject({ kind: 'exec-response', outcome: {
      kind: 'exited', exitCode, stdout: 'retained-output', stderr: 'retained-error',
    } });
    const activities = await readCapsuleActivities(fixture);
    const message = fault === 'http-rejection'
      ? 'Collector rejected the activity root span with HTTP 503' : 'fetch failed';
    expect(activities).toMatchObject([{ kind: 'completed', outcome: {
      kind: 'exited', exitCode, stdout: 'retained-output', stderr: 'retained-error',
    }, telemetry: { kind: 'telemetry-execution-scope-completed-v1',
      result: { kind: 'telemetry-scope-failed', message } } }]);
    expect(receiver.observed).toHaveLength(1);
    expect(receiver.observed[0].authorization).toBe('Bearer test-collector-token');
    expect(JSON.parse(receiver.observed[0].body)).toMatchObject({ resourceSpans: [{
      scopeSpans: [{ spans: [{ traceId: activities[0].telemetry.context.traceId,
        spanId: activities[0].telemetry.context.spanId, status: { code: exitCode === 0 ? 1 : 2 } }] }],
    }] });
    expect(JSON.stringify(activities)).not.toContain('private-collector-diagnostic');
  } finally {
    await fixture.close();
    await receiver.close();
  }
});
